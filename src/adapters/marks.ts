/** Mark adapter (PROPERTY / COLLECTIBLE): latest valuation mark is the
 *  value; the mark series is the value history (spec §3.2). Pure. */
import type { Valuation, ValuationMarkPoint } from './types';

export function markValuation(marks: ValuationMarkPoint[]): Valuation | null {
  if (marks.length === 0) return null;
  const latest = marks.reduce((a, b) => (b.date.localeCompare(a.date) > 0 ? b : a));
  return {
    amountMinor: latest.valueMinor,
    currency: latest.currency,
    asOf: latest.date,
    stale: true, // marks are always "as of when you said so"
  };
}
