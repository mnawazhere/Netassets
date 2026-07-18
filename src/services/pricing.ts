/** Price refresh: fetch quotes for market-priced assets, upsert
 *  price_cache. Failures keep the cached price (valuations go stale, the
 *  app never blanks). Refresh on app open + pull-to-refresh (spec §3.1). */
import { eq } from 'drizzle-orm';

import { isMarketPriced } from '@/adapters';
import type { Db } from '@/db/client';
import { assets, priceCache } from '@/db/schema';
import { uuid } from '@/lib/uuid';

import { fetchCryptoPrice, fetchEquityPrice } from './providers';

export async function refreshPrices(db: Db): Promise<{ updated: string[]; failed: string[] }> {
  const all = await db.select().from(assets);
  const updated: string[] = [];
  const failed: string[] = [];

  for (const asset of all) {
    if (!isMarketPriced(asset.class) || !asset.symbol) continue;
    const point =
      asset.class === 'CRYPTO'
        ? await fetchCryptoPrice(asset.symbol)
        : await fetchEquityPrice(asset.symbol);
    if (!point) {
      failed.push(asset.symbol);
      continue;
    }
    await db
      .insert(priceCache)
      .values({ id: uuid(), ...point })
      .onConflictDoUpdate({
        target: [priceCache.symbol, priceCache.currency],
        set: { priceMinor: point.priceMinor, asOf: point.asOf },
      });
    updated.push(asset.symbol);
  }
  return { updated, failed };
}

export async function cachedPrice(db: Db, symbol: string) {
  const rows = await db.select().from(priceCache).where(eq(priceCache.symbol, symbol.toUpperCase()));
  return rows[0] ?? null;
}
