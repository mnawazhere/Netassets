/** Assembles db rows → adapter valuations → base-currency net worth and
 *  per-asset return breakdowns. Thin glue; all math lives in domain/. */
import { isMarketPriced, markValuation, marketValuation } from '@/adapters';
import type { Valuation } from '@/adapters/types';
import type { Db } from '@/db/client';
import { makeRateSeries, rateOn, type RateSeries } from '@/domain/fx';
import { convertMinor } from '@/domain/money';
import { aggregateNetWorth, type AssetSnapshot, type NetWorth } from '@/domain/portfolio';
import {
  positionsByAccount,
  positionValueMinor,
  type AccountPosition,
} from '@/domain/position';
import {
  computeAssetReturnInBase,
  type BaseReturnBreakdown,
} from '@/domain/returns/baseCurrency';
import { listAssets, transactionsFor, valuationMarksFor } from '@/repositories/assets';
import { listLiabilities } from '@/repositories/liabilities';
import { SETTING_KEYS, getSetting } from '@/repositories/settings';

import { getRateSeries } from './fx';
import { cachedPrice } from './pricing';

const FRESH_WINDOW_MS = 15 * 60 * 1000;

/** The dirham peg: USD→AED has traded at 3.6725 since 1997 (spec §8) —
 *  the guaranteed last-resort rate when nothing was ever cached. */
const USD_AED_PEG = 3.6725;

type AssetRow = Awaited<ReturnType<typeof listAssets>>[number];
type TxnRows = Awaited<ReturnType<typeof transactionsFor>>;

interface AssetView {
  asset: AssetRow;
  valuation: Valuation | null;
  /** Native-currency location slices (spec §3.1 v6). */
  locations: { label: string; amountMinor: number }[];
  /** Per-account breakdown for market assets (asset detail screen). */
  accountPositions: (AccountPosition & { valueMinor: number })[];
  txns: TxnRows;
}

async function loadAssetView(db: Db, asset: AssetRow): Promise<AssetView> {
  const txns = await transactionsFor(db, asset.id);

  if (isMarketPriced(asset.class) && asset.symbol) {
    const price = await cachedPrice(db, asset.symbol);
    if (!price) return { asset, valuation: null, locations: [], accountPositions: [], txns };
    // Freshness = when WE last fetched, not the quote's market date — an
    // EOD quote fetched a minute ago is fresh (the banner used to lie here).
    const fresh =
      price.fetchedAt !== '' &&
      Date.now() - new Date(price.fetchedAt).getTime() < FRESH_WINDOW_MS;
    const valuation = marketValuation(txns, price, { fresh });
    const positions = positionsByAccount(txns).filter((p) => p.quantity !== 0);
    const accountPositions = positions.map((p) => ({
      ...p,
      valueMinor: positionValueMinor(p.quantity, price.priceMinor),
    }));
    return {
      asset,
      valuation,
      // Location derives from source_account — NEVER asset.platform (§3.1 v6).
      locations: accountPositions.map((p) => ({
        label: p.account ?? asset.platform ?? 'Unassigned',
        amountMinor: p.valueMinor,
      })),
      accountPositions,
      txns,
    };
  }

  const marks = await valuationMarksFor(db, asset.id);
  const valuation = markValuation(marks);
  return {
    asset,
    valuation,
    locations: valuation
      ? [{ label: asset.platform ?? 'Unassigned', amountMinor: valuation.amountMinor }]
      : [],
    accountPositions: [],
    txns,
  };
}

/**
 * Convert a transaction's amount from ITS OWN currency into the valuation
 * currency at the txn's own date (spec §8 — per-date, per-row conversion),
 * crossing through the base when the pair isn't direct. Transactions carry
 * a per-row `currency` (a USD equity can have an AED-denominated BUY: what
 * actually left the bank), which the returns engine ignores — so we
 * normalize the stream here first. Caller guarantees every non-base
 * currency involved has a non-empty series in `rates`.
 */
function txnInValuationCurrency(
  txn: TxnRows[number],
  valuationCurrency: string,
  baseCurrency: string,
  rates: Record<string, RateSeries>
): TxnRows[number] {
  const from = txn.currency.toUpperCase();
  const to = valuationCurrency.toUpperCase();
  const base = baseCurrency.toUpperCase();
  if (from === to) return txn;
  const inBase =
    from === base
      ? txn.amountMinor
      : convertMinor(txn.amountMinor, from, base, rateOn(rates[from], txn.date));
  const amountMinor =
    to === base ? inBase : convertMinor(inBase, base, to, 1 / rateOn(rates[to], txn.date));
  return { ...txn, amountMinor };
}

export interface PortfolioView {
  netWorth: NetWorth;
  baseCurrency: string;
  hourlyRateMinor: number;
  /** True when any market-priced valuation is being served from stale cache. */
  anyStale: boolean;
  /** Oldest price timestamp backing a stale valuation (for the banner). */
  oldestAsOf: string | null;
  assets: {
    id: string;
    name: string;
    class: string;
    currency: string;
    providerId: string | null;
    valuation: Valuation | null;
    accountPositions: AssetView['accountPositions'];
    breakdown: BaseReturnBreakdown | null;
  }[];
}

export async function computePortfolioView(db: Db, today: string): Promise<PortfolioView> {
  const baseCurrency = (await getSetting(db, SETTING_KEYS.baseCurrency)) ?? 'AED';
  const hourlyRateMinor = Number((await getSetting(db, SETTING_KEYS.hourlyRateMinor)) ?? '0');
  const all = await listAssets(db);
  const liabilityRows = await listLiabilities(db);

  const base = baseCurrency.toUpperCase();
  const snapshots: AssetSnapshot[] = [];
  // Only NON-EMPTY series go in here: an empty series would slip past
  // aggregateNetWorth's `!series` guard and make rateOn() throw, killing
  // the whole dashboard instead of degrading (spec §8: stale, not dead).
  const rates: Record<string, RateSeries> = {};
  const rateLookups = new Set<string>();
  const assets: PortfolioView['assets'] = [];
  let anyStale = false;
  let oldestAsOf: string | null = null;

  const loadRates = async (currency: string): Promise<void> => {
    const c = currency.toUpperCase();
    if (c === base || rateLookups.has(c)) return;
    rateLookups.add(c);
    let series = await getRateSeries(db, c, baseCurrency);
    // Spec §8 last resort: the peg means USD→AED is always convertible,
    // even on a fresh offline install with an empty fx_rates table.
    if (series.points.length === 0 && c === 'USD' && base === 'AED') {
      series = makeRateSeries([{ date: today, rate: USD_AED_PEG }]);
    }
    if (series.points.length > 0) rates[c] = series;
  };

  /** True when amounts in `currency` can be converted to base. */
  const convertible = (currency: string): boolean => {
    const c = currency.toUpperCase();
    return c === base || Boolean(rates[c]);
  };

  for (const asset of all) {
    await loadRates(asset.currency);

    const view = await loadAssetView(db, asset);
    if (view.valuation) await loadRates(view.valuation.currency);
    for (const txn of view.txns) await loadRates(txn.currency);

    // A valuation whose currency has no usable rate series degrades to
    // "unvalued" (surfaced by aggregateNetWorth, spec §9) — never a throw,
    // never a silent parity conversion.
    const valuationConvertible = view.valuation !== null && convertible(view.valuation.currency);
    snapshots.push({
      id: asset.id,
      name: asset.name,
      class: asset.class,
      platform: asset.platform,
      valuation: valuationConvertible ? view.valuation : null,
      locations: valuationConvertible ? view.locations : [],
    });

    if (view.valuation && isMarketPriced(asset.class) && view.valuation.stale) {
      anyStale = true;
      if (!oldestAsOf || view.valuation.asOf < oldestAsOf) oldestAsOf = view.valuation.asOf;
    }

    let breakdown: BaseReturnBreakdown | null = null;
    if (
      view.valuation &&
      valuationConvertible &&
      view.txns.every((t) => convertible(t.currency))
    ) {
      const valuation = view.valuation;
      breakdown = computeAssetReturnInBase({
        transactions: view.txns.map((t) =>
          txnInValuationCurrency(t, valuation.currency, baseCurrency, rates)
        ),
        currentValueMinor: valuation.amountMinor,
        asOf: today,
        currency: valuation.currency,
        baseCurrency,
        // Only the identity case can miss the map here: `convertible`
        // guaranteed a real series whenever valuation currency ≠ base.
        rates:
          rates[valuation.currency.toUpperCase()] ??
          makeRateSeries([{ date: today, rate: 1 }]),
        hourlyRateMinor,
      });
    }
    assets.push({
      id: asset.id,
      name: asset.name,
      class: asset.class,
      currency: asset.currency,
      providerId: asset.providerId,
      valuation: view.valuation,
      accountPositions: view.accountPositions,
      breakdown,
    });
  }

  // Liability currencies need series too (a USD card against an AED base).
  for (const l of liabilityRows) await loadRates(l.currency);

  return {
    netWorth: aggregateNetWorth(snapshots, rates, baseCurrency, today, liabilityRows),
    baseCurrency,
    hourlyRateMinor,
    anyStale,
    oldestAsOf,
    assets,
  };
}
