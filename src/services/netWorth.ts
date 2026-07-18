/** Assembles db rows → adapter valuations → base-currency net worth and
 *  per-asset return breakdowns. Thin glue; all math lives in domain/. */
import { isMarketPriced, markValuation, marketValuation } from '@/adapters';
import type { Valuation } from '@/adapters/types';
import type { Db } from '@/db/client';
import { makeRateSeries, type RateSeries } from '@/domain/fx';
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
import { SETTING_KEYS, getSetting } from '@/repositories/settings';

import { getRateSeries } from './fx';
import { cachedPrice } from './pricing';

const FRESH_WINDOW_MS = 15 * 60 * 1000;

type AssetRow = Awaited<ReturnType<typeof listAssets>>[number];
type TxnRows = Awaited<ReturnType<typeof transactionsFor>>;

interface AssetView {
  asset: AssetRow;
  valuation: Valuation | null;
  /** Native-currency location slices (spec §3.1 v6). */
  locations: Array<{ label: string; amountMinor: number }>;
  /** Per-account breakdown for market assets (asset detail screen). */
  accountPositions: Array<AccountPosition & { valueMinor: number }>;
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

export interface PortfolioView {
  netWorth: NetWorth;
  baseCurrency: string;
  hourlyRateMinor: number;
  /** True when any market-priced valuation is being served from stale cache. */
  anyStale: boolean;
  /** Oldest price timestamp backing a stale valuation (for the banner). */
  oldestAsOf: string | null;
  assets: Array<{
    id: string;
    name: string;
    class: string;
    currency: string;
    providerId: string | null;
    valuation: Valuation | null;
    accountPositions: AssetView['accountPositions'];
    breakdown: BaseReturnBreakdown | null;
  }>;
}

export async function computePortfolioView(db: Db, today: string): Promise<PortfolioView> {
  const baseCurrency = (await getSetting(db, SETTING_KEYS.baseCurrency)) ?? 'AED';
  const hourlyRateMinor = Number((await getSetting(db, SETTING_KEYS.hourlyRateMinor)) ?? '0');
  const all = await listAssets(db);

  const snapshots: AssetSnapshot[] = [];
  const rates: Record<string, RateSeries> = {};
  const assets: PortfolioView['assets'] = [];
  let anyStale = false;
  let oldestAsOf: string | null = null;

  for (const asset of all) {
    const currency = asset.currency.toUpperCase();
    if (currency !== baseCurrency.toUpperCase() && !rates[currency]) {
      rates[currency] = await getRateSeries(db, currency, baseCurrency);
    }

    const view = await loadAssetView(db, asset);
    snapshots.push({
      id: asset.id,
      name: asset.name,
      class: asset.class,
      platform: asset.platform,
      valuation: view.valuation,
      locations: view.locations,
    });

    if (view.valuation && isMarketPriced(asset.class) && view.valuation.stale) {
      anyStale = true;
      if (!oldestAsOf || view.valuation.asOf < oldestAsOf) oldestAsOf = view.valuation.asOf;
    }

    let breakdown: BaseReturnBreakdown | null = null;
    if (view.valuation) {
      breakdown = computeAssetReturnInBase({
        transactions: view.txns,
        currentValueMinor: view.valuation.amountMinor,
        asOf: today,
        currency: view.valuation.currency,
        baseCurrency,
        rates:
          rates[view.valuation.currency.toUpperCase()] ??
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

  return {
    netWorth: aggregateNetWorth(snapshots, rates, baseCurrency, today),
    baseCurrency,
    hourlyRateMinor,
    anyStale,
    oldestAsOf,
    assets,
  };
}
