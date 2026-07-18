import type { AssetClass } from '@/db/schema';

export { marketValuation } from './market';
export { markValuation } from './marks';
export type { PricePoint, Valuation, ValuationMarkPoint } from './types';

export const MARKET_PRICED_CLASSES: ReadonlySet<AssetClass> = new Set([
  'EQUITY',
  'CRYPTO',
  'ETF',
]);

export function isMarketPriced(cls: AssetClass): boolean {
  return MARKET_PRICED_CLASSES.has(cls);
}
