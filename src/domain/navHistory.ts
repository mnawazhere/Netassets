/**
 * NAV-over-time series (PM tier 2). Pure assembly of data we already store.
 *
 * Valuation policy v1 (the UI labels it): mark-valued assets step through
 * their dated marks; market assets are historical quantity × TODAY's price —
 * price history isn't stored yet, so the curve shows position growth, not
 * price movement. Liabilities subtract at current outstanding (no balance
 * history either). Honest, labeled, upgradeable.
 */

export interface HistoryAsset {
  id: string;
  kind: 'marks' | 'market';
  /** kind='marks': dated valuation marks, native minor units. */
  marks?: { date: string; valueMinor: number }[];
  /** kind='market': signed quantity deltas from BUY/SELL rows. */
  quantityChanges?: { date: string; delta: number }[];
  /** kind='market': today's native per-unit price. */
  currentPriceMinor?: number;
  /** Native minor → base minor (spot). */
  toBase: (amountMinor: number) => number;
}

export interface HistoryLiability {
  outstandingBaseMinor: number;
  /** Date the debt is known to exist from (its financed asset's first
   *  event, else the balance's as-of date). Undefined = all history.
   *  Without this, a 2024 property finance would drag 2023 NAV negative. */
  fromDate?: string;
}

export interface NavPoint {
  /** Month-end ISO date (or the range end for the final partial month). */
  date: string;
  totalMinor: number;
}

/** Last day of the month containing `d` (UTC-safe string math). */
function monthEnd(year: number, month0: number): string {
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  return last.toISOString().slice(0, 10);
}

/** Month-end sample dates from `from` to `to` inclusive (final point clamps
 *  to `to` so "this month so far" is a real point, not a future date). */
function sampleDates(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7)) - 1;
  for (;;) {
    const end = monthEnd(y, m);
    if (end >= to) {
      out.push(to);
      return out;
    }
    out.push(end);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
}

export function navHistory(
  assets: HistoryAsset[],
  liabilities: HistoryLiability[],
  from: string,
  to: string
): NavPoint[] {
  return sampleDates(from, to).map((date) => {
    const debt = liabilities.reduce(
      (s, l) => s + (l.fromDate === undefined || l.fromDate <= date ? l.outstandingBaseMinor : 0),
      0
    );
    let total = 0;
    for (const a of assets) {
      if (a.kind === 'marks') {
        // Latest mark on or before the sample date; none → not held yet.
        let value = 0;
        for (const mark of a.marks ?? []) {
          if (mark.date <= date) value = mark.valueMinor;
        }
        total += a.toBase(value);
      } else {
        let qty = 0;
        for (const c of a.quantityChanges ?? []) {
          if (c.date <= date) qty += c.delta;
        }
        if (qty !== 0 && a.currentPriceMinor) {
          total += a.toBase(Math.round(qty * a.currentPriceMinor));
        }
      }
    }
    return { date, totalMinor: total - debt };
  });
}
