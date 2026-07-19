/** Assembles db rows into the Tier 2 dashboard series: NAV-over-time and
 *  the passive-income year view. Thin glue — math lives in domain/. */
import { isMarketPriced } from '@/adapters';
import type { Db } from '@/db/client';
import { makeRateSeries, rateOn, type RateSeries } from '@/domain/fx';
import { aggregateIncome, type IncomeView } from '@/domain/income';
import { convertMinor } from '@/domain/money';
import { navHistory, type HistoryAsset, type NavPoint } from '@/domain/navHistory';
import { listAssets, transactionsFor, valuationMarksFor } from '@/repositories/assets';
import { listLiabilities } from '@/repositories/liabilities';
import { SETTING_KEYS, getSetting } from '@/repositories/settings';

import { getRateSeries } from './fx';
import { cachedPrice } from './pricing';

const USD_AED_PEG = 3.6725;

/** Spot converters per currency, sharing netWorth.ts's degradation contract:
 *  no usable series → null (callers surface, never guess). */
async function makeToBase(
  db: Db,
  baseCurrency: string,
  today: string
): Promise<(amountMinor: number, currency: string) => number | null> {
  const base = baseCurrency.toUpperCase();
  const rates: Record<string, RateSeries> = {};
  const looked = new Set<string>();
  const load = async (currency: string): Promise<void> => {
    const c = currency.toUpperCase();
    if (c === base || looked.has(c)) return;
    looked.add(c);
    let series = await getRateSeries(db, c, baseCurrency);
    if (series.points.length === 0 && c === 'USD' && base === 'AED') {
      series = makeRateSeries([{ date: today, rate: USD_AED_PEG }]);
    }
    if (series.points.length > 0) rates[c] = series;
  };
  // Eagerly load every currency that appears anywhere (assets, txns, debts).
  for (const a of await listAssets(db)) {
    await load(a.currency);
    for (const t of await transactionsFor(db, a.id)) await load(t.currency);
  }
  for (const l of await listLiabilities(db)) await load(l.currency);

  return (amountMinor, currency) => {
    const c = currency.toUpperCase();
    if (c === base) return amountMinor;
    const series = rates[c];
    if (!series) return null;
    return convertMinor(amountMinor, c, baseCurrency, rateOn(series, today));
  };
}

export interface NavHistoryResult {
  points: NavPoint[];
  baseCurrency: string;
}

/** Month-end NAV for the trailing year. Market legs use TODAY's cached
 *  price (no price history stored yet) — the UI labels this. */
export async function computeNavHistory(db: Db, today: string): Promise<NavHistoryResult> {
  const baseCurrency = (await getSetting(db, SETTING_KEYS.baseCurrency)) ?? 'AED';
  const toBase = await makeToBase(db, baseCurrency, today);

  const historyAssets: HistoryAsset[] = [];
  for (const asset of await listAssets(db)) {
    if (isMarketPriced(asset.class) && asset.symbol) {
      const price = await cachedPrice(db, asset.symbol);
      const txns = await transactionsFor(db, asset.id);
      const priceCurrency = price?.currency ?? asset.currency;
      historyAssets.push({
        id: asset.id,
        kind: 'market',
        quantityChanges: txns
          .filter((t) => (t.type === 'BUY' || t.type === 'SELL') && t.quantity)
          .map((t) => ({ date: t.date, delta: t.type === 'BUY' ? t.quantity! : -t.quantity! })),
        currentPriceMinor: price?.priceMinor,
        toBase: (m) => toBase(m, priceCurrency) ?? 0,
      });
    } else {
      const marks = await valuationMarksFor(db, asset.id);
      historyAssets.push({
        id: asset.id,
        kind: 'marks',
        marks: marks.map((m) => ({ date: m.date, valueMinor: m.valueMinor })),
        toBase: (m) => toBase(m, marks[0]?.currency ?? asset.currency) ?? 0,
      });
    }
  }

  // A debt exists from its financed asset's first event (an Ijarah starts
  // with the purchase), else from its balance's as-of date.
  const firstEventByAsset = new Map<string, string>();
  for (const a of historyAssets) {
    const dates =
      a.kind === 'marks'
        ? (a.marks ?? []).map((m) => m.date)
        : (a.quantityChanges ?? []).map((c) => c.date);
    if (dates.length > 0) firstEventByAsset.set(a.id, [...dates].sort()[0]);
  }
  const liabilities = (await listLiabilities(db)).map((l) => ({
    outstandingBaseMinor: toBase(l.outstandingMinor, l.currency) ?? 0,
    fromDate: (l.assetId ? firstEventByAsset.get(l.assetId) : undefined) ?? l.asOf,
  }));

  // Start where the DATA starts (earliest mark or position change) so the
  // curve shows actual growth — a fixed trailing window can lie flat when
  // all history predates it. Capped at 36 months, floored at 12.
  const events = historyAssets.flatMap((a) =>
    a.kind === 'marks'
      ? (a.marks ?? []).map((m) => m.date)
      : (a.quantityChanges ?? []).map((c) => c.date)
  );
  const yearAgo = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
  const cap = `${Number(today.slice(0, 4)) - 3}-${today.slice(5, 7)}-01`;
  const earliest = events.length > 0 ? [...events].sort()[0] : yearAgo;
  const from = earliest < cap ? cap : earliest > yearAgo ? yearAgo : `${earliest.slice(0, 7)}-01`;
  return { points: navHistory(historyAssets, liabilities, from, today), baseCurrency };
}

export interface IncomeResult extends IncomeView {
  baseCurrency: string;
}

/** This-year DIVIDEND + RENT rollup (PM tier 2 income view). When the
 *  current year has none yet (January, or a data gap), falls back to the
 *  previous year — the card labels whichever year it shows. */
export async function computeIncomeView(db: Db, today: string): Promise<IncomeResult> {
  const baseCurrency = (await getSetting(db, SETTING_KEYS.baseCurrency)) ?? 'AED';
  const toBase = await makeToBase(db, baseCurrency, today);

  const incomeTxns = [];
  for (const asset of await listAssets(db)) {
    for (const t of await transactionsFor(db, asset.id)) {
      incomeTxns.push({
        assetId: asset.id,
        assetName: asset.name,
        type: t.type,
        date: t.date,
        amountMinor: t.amountMinor,
        currency: t.currency,
      });
    }
  }

  const year = Number(today.slice(0, 4));
  let view = aggregateIncome(incomeTxns, year, toBase);
  if (view.totalMinor === 0 && view.unconverted.length === 0) {
    const previous = aggregateIncome(incomeTxns, year - 1, toBase);
    if (previous.totalMinor !== 0) view = previous;
  }
  return { ...view, baseCurrency };
}
