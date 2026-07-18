/** Position math derived from the transaction stream (no stored lots). */
import { roundHalfEven } from './money';
import type { CashTxn } from './returns/engine';

/** Units currently held: Σ BUY quantities − Σ SELL quantities. */
export function quantityHeld(txns: Array<CashTxn & { quantity?: number | null }>): number {
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
