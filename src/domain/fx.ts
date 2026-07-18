/**
 * Dated FX (spec §8 v4): every historical flow converts at ITS OWN
 * as-of-date rate — never one spot rate for a whole stream. Converting
 * history at today's rate strips out exactly the FX gain/loss this app
 * exists to expose.
 *
 * Pure — rates come in as data; fetching/caching lives in services/.
 */
import { convertMinor } from './money';
import type { CashTxn } from './returns/engine';

export interface RatePoint {
  /** ISO YYYY-MM-DD */
  date: string;
  /** 1 unit of base currency = `rate` units of quote currency. */
  rate: number;
}

/** Sorted-by-date rate series for one currency pair. */
export interface RateSeries {
  points: RatePoint[]; // ascending by date
}

export function makeRateSeries(points: RatePoint[]): RateSeries {
  return { points: [...points].sort((a, b) => a.date.localeCompare(b.date)) };
}

/**
 * Rate applicable on `date`: the latest point on or before it (markets
 * close on weekends; statements land on gaps). A date before the first
 * point falls back to the earliest known rate — imperfect but honest,
 * and never a silent 1.0. An empty series is a programming error.
 */
export function rateOn(series: RateSeries, date: string): number {
  const { points } = series;
  if (points.length === 0) {
    throw new Error('rateOn: empty rate series — fetch rates before converting');
  }
  let candidate = points[0];
  for (const p of points) {
    if (p.date.localeCompare(date) > 0) break;
    candidate = p;
  }
  return candidate.rate;
}

/** Convert a native-currency stream to `to`, each flow at its own date. */
export function convertAtDates(
  txns: CashTxn[],
  from: string,
  to: string,
  series: RateSeries
): CashTxn[] {
  return txns.map((t) => ({
    ...t,
    amountMinor: convertMinor(t.amountMinor, from, to, rateOn(series, t.date)),
  }));
}
