/** Every adapter answers ONE question (spec §3): what is this asset worth
 *  right now, in its native currency? */
export interface Valuation {
  amountMinor: number;
  currency: string;
  /** When this value was established (price timestamp / mark date). */
  asOf: string;
  /** True when served from cache/marks rather than a fresh quote. */
  stale: boolean;
}

export interface PricePoint {
  symbol: string;
  currency: string;
  priceMinor: number;
  asOf: string;
}

export interface ValuationMarkPoint {
  date: string;
  valueMinor: number;
  currency: string;
}
