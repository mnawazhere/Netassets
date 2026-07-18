/** Position math derived from the transaction stream (no stored lots). */
import { roundHalfEven } from './money';
import type { CashTxn } from './returns/engine';

/**
 * Canonical account key for source_account. Positions group by EXACT
 * string, so 'eToro' vs 'etoro' would silently split one broker into two
 * location lines — every entry path must normalize through here (imports
 * already use lowercase).
 */
export function normalizeAccount(raw: string | null | undefined): string | null {
  const s = raw?.trim().toLowerCase();
  return s ? s : null;
}

/** Units currently held: Σ BUY quantities − Σ SELL quantities. */
export function quantityHeld(txns: (CashTxn & { quantity?: number | null })[]): number {
  let qty = 0;
  for (const t of txns) {
    if (t.type === 'BUY') qty += t.quantity ?? 0;
    else if (t.type === 'SELL') qty -= t.quantity ?? 0;
  }
  return qty;
}

/** Market value in minor units: fractional quantities round half-even. */
export function positionValueMinor(quantity: number, unitPriceMinor: number): number {
  return roundHalfEven(quantity * unitPriceMinor);
}

export interface AccountPosition {
  /** source_account label, or null for account-less (manual) rows. */
  account: string | null;
  quantity: number;
  /** Σ|BUY amounts| on this account — basis for average cost. */
  boughtCostMinor: number;
  boughtQuantity: number;
  /** Average purchase price per unit on this account (null if nothing bought). */
  avgCostMinor: number | null;
}

/**
 * Positions per source_account (spec §3.1 v6): ONE asset per security,
 * but the location view derives from each transaction's account — never
 * from asset.platform, or a security split across two brokers collapses
 * into whichever imported first.
 */
export function positionsByAccount(
  txns: (CashTxn & { quantity?: number | null; sourceAccount?: string | null })[]
): AccountPosition[] {
  const map = new Map<string | null, AccountPosition>();
  for (const t of txns) {
    if (t.type !== 'BUY' && t.type !== 'SELL') continue;
    const key = t.sourceAccount ?? null;
    let pos = map.get(key);
    if (!pos) {
      pos = { account: key, quantity: 0, boughtCostMinor: 0, boughtQuantity: 0, avgCostMinor: null };
      map.set(key, pos);
    }
    const qty = t.quantity ?? 0;
    if (t.type === 'BUY') {
      pos.quantity += qty;
      pos.boughtQuantity += qty;
      pos.boughtCostMinor += Math.abs(t.amountMinor);
    } else {
      pos.quantity -= qty;
    }
  }
  for (const pos of map.values()) {
    pos.avgCostMinor =
      pos.boughtQuantity > 0 ? roundHalfEven(pos.boughtCostMinor / pos.boughtQuantity) : null;
  }
  return [...map.values()];
}
