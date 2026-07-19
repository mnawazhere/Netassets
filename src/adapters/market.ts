/** Market adapter (EQUITY / CRYPTO / ETF): quantity held × cached price.
 *  Pure — price freshness/fetching lives in services/pricing.ts. */
import { positionValueMinor, quantityHeld } from '@/domain/position';
import type { CashTxn } from '@/domain/returns/engine';

import type { PricePoint, Valuation } from './types';

export function marketValuation(
  txns: (CashTxn & { quantity?: number | null })[],
  price: PricePoint,
  opts: { fresh: boolean }
): Valuation | null {
  const qty = quantityHeld(txns);
  // Zero held BECAUSE quantities are missing (a qty-less BUY) is unknowable,
  // not zero — valuing it at 0 fabricates a −100% loss. Surface as unvalued.
  // A genuine sold-out position (quantities present, netting to 0) stays 0.
  const hasUnknownQty = txns.some(
    (t) => (t.type === 'BUY' || t.type === 'SELL') && t.quantity == null
  );
  if (qty === 0 && hasUnknownQty) return null;
  return {
    amountMinor: positionValueMinor(qty, price.priceMinor),
    currency: price.currency,
    asOf: price.asOf,
    stale: !opts.fresh,
  };
}
