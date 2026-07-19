/**
 * Actual-spend aggregation (§14 projected vs actual). Pure; conversion is
 * injected like income.ts/portfolio.ts so the service layer owns rates.
 */

export interface SpendEntry {
  /** 'YYYY-MM'. */
  month: string;
  /** Positive minor units in `currency`. */
  amountMinor: number;
  currency: string;
}

export interface SpendView {
  year: number;
  /** Index 0 = January … 11 = December, base minor units, zero-filled. */
  byMonth: number[];
  ytdMinor: number;
  /** Months with at least one recorded row. */
  monthsRecorded: number;
  /** ytd ÷ monthsRecorded (0 when nothing recorded) — the honest
   *  annualization basis: only measured months count. */
  avgMonthMinor: number;
  /** Rows whose currency had no usable rate — surfaced, never guessed. */
  unconverted: { month: string }[];
}

export function aggregateSpend(
  entries: SpendEntry[],
  year: number,
  toBase: (amountMinor: number, currency: string) => number | null
): SpendView {
  const byMonth = Array<number>(12).fill(0);
  const unconverted: SpendView['unconverted'] = [];

  for (const e of entries) {
    if (!e.month.startsWith(`${year}-`)) continue;
    const amount = toBase(e.amountMinor, e.currency);
    if (amount === null) {
      unconverted.push({ month: e.month });
      continue;
    }
    const m = Number(e.month.slice(5, 7)) - 1;
    if (m >= 0 && m < 12) byMonth[m] += amount;
  }

  const ytdMinor = byMonth.reduce((s, v) => s + v, 0);
  const monthsRecorded = byMonth.filter((v) => v !== 0).length;
  return {
    year,
    byMonth,
    ytdMinor,
    monthsRecorded,
    avgMonthMinor: monthsRecorded > 0 ? Math.round(ytdMinor / monthsRecorded) : 0,
    unconverted,
  };
}
