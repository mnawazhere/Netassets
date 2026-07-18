/** The shape every capture path (PDF, screenshot, voice, manual, CSV)
 *  converges on BEFORE asset resolution and dedup (spec §6). */
export interface ParsedTransaction {
  /** Hints for resolving which asset this row belongs to. */
  asset: {
    /** Ticker for market-priced classes (AAPL, BTC). */
    symbol?: string | null;
    /** Human name — the resolution key for property/collectibles. */
    name?: string | null;
    class: 'EQUITY' | 'CRYPTO' | 'ETF' | 'PROPERTY' | 'COLLECTIBLE';
    platform?: string | null;
    currency: string;
  };
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'RENT' | 'FEE' | 'MAINTENANCE' | 'TRANSFER';
  /** ISO YYYY-MM-DD */
  date: string;
  /** Signed minor units: buys/fees −, sells/income +. */
  amountMinor: number;
  currency: string;
  quantity?: number | null;
  hoursSpent?: number;
  sourceAccount?: string | null;
  /** Broker/order id when the statement provides one — the strong dedup key. */
  sourceTxnId?: string | null;
  note?: string | null;
}

/** What the dedup planner decides per incoming row. */
export type ImportAction =
  | { action: 'insert' }
  | { action: 'skip-exact'; reason: 'strong-key-match' | 'covered-weak-match' }
  | { action: 'review'; reason: 'weak-collision' | 'near-match'; conflictsWith: string | null };

/** Minimal view of an existing transaction the planner compares against. */
export interface ExistingTxn {
  id: string;
  assetId: string;
  fingerprint: string;
  type: string;
  date: string;
  amountMinor: number;
  quantity: number | null;
  sourceAccount: string | null;
}

/** A statement window already imported for an account (spec §6 coverage). */
export interface CoveredRange {
  sourceAccount: string | null;
  periodStart: string;
  periodEnd: string;
}
