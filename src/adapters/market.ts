/** Market adapter (EQUITY / CRYPTO / ETF): quantity held × cached price.
 *  Pure — price freshness/fetching lives in services/pricing.ts. */
import { positionValueMinor, quantityHeld } from '@/domain/position';
import type { CashTxn } from '@/domain/returns/engine';

import type { PricePoint, Valuation } from './types';

export function marketValuation(
  txns: (CashTxn & { quantity?: number | null })[],
  price: PricePoint,
  opts: { fresh: boolean }
): Valuation {
  return {
    amountMinor: positionValueMinor(quantityHeld(txns), price.priceMinor),
    currency: price.currency,
    asOf: price.asOf,
    stale: !opts.fresh,
  };
}
