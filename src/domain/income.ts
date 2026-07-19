/**
 * Passive-income aggregation (PM tier 2): every recorded DIVIDEND and RENT
 * rolled up to "base-currency X earned this year". Pure — conversion is
 * injected so the service layer owns rates, matching portfolio.ts.
 */

export interface IncomeTxn {
  assetId: string;
  assetName: string;
  type: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Signed minor units in `currency` — a clawback/refund row stays negative. */
  amountMinor: number;
  currency: string;
}

export interface IncomeView {
  year: number;
  totalMinor: number;
  byType: Record<string, number>;
  /** Descending by amount. */
  byAsset: { assetId: string; assetName: string; amountMinor: number }[];
  /** Index 0 = January … 11 = December, zero-filled. */
  byMonth: number[];
  /** Rows whose currency could not be converted — surfaced, never guessed. */
  unconverted: { assetId: string; assetName: string; date: string }[];
}

const INCOME_TYPES = new Set(['DIVIDEND', 'RENT']);

/**
 * `toBase` converts signed minor units of `currency` into base minor units
 * (spot is fine: income display is a this-year number, per-date precision
 * belongs to the returns engine). Return null = no usable rate.
 */
export function aggregateIncome(
  txns: IncomeTxn[],
  year: number,
  toBase: (amountMinor: number, currency: string) => number | null
): IncomeView {
  const byType: Record<string, number> = {};
  const byAssetMap = new Map<string, { assetId: string; assetName: string; amountMinor: number }>();
  const byMonth = Array<number>(12).fill(0);
  const unconverted: IncomeView['unconverted'] = [];
  let total = 0;

  for (const t of txns) {
    if (!INCOME_TYPES.has(t.type)) continue;
    if (!t.date.startsWith(`${year}-`)) continue;
    const amount = toBase(t.amountMinor, t.currency);
    if (amount === null) {
      unconverted.push({ assetId: t.assetId, assetName: t.assetName, date: t.date });
      continue;
    }
    total += amount;
    byType[t.type] = (byType[t.type] ?? 0) + amount;
    const entry = byAssetMap.get(t.assetId) ?? {
      assetId: t.assetId,
      assetName: t.assetName,
      amountMinor: 0,
    };
    entry.amountMinor += amount;
    byAssetMap.set(t.assetId, entry);
    const month = Number(t.date.slice(5, 7)) - 1;
    if (month >= 0 && month < 12) byMonth[month] += amount;
  }

  return {
    year,
    totalMinor: total,
    byType,
    byAsset: [...byAssetMap.values()].sort((a, b) => b.amountMinor - a.amountMinor),
    byMonth,
    unconverted,
  };
}
