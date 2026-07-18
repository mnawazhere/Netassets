/** Price refresh: fetch quotes for market-priced assets, upsert
 *  price_cache. Failures keep the cached price (valuations go stale, the
 *  app never blanks). Refresh on app open + pull-to-refresh (spec §3.1). */
import { eq } from 'drizzle-orm';

import { isMarketPriced } from '@/adapters';
import type { Db } from '@/db/client';
import { assets, priceCache } from '@/db/schema';
import { uuid } from '@/lib/uuid';

import { fetchCryptoPrice, fetchEquityPrice } from './providers';

async function upsertPrice(
  db: Db,
  point: { symbol: string; currency: string; priceMinor: number; asOf: string }
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  await db
    .insert(priceCache)
    .values({ id: uuid(), fetchedAt, ...point })
    .onConflictDoUpdate({
      target: [priceCache.symbol, priceCache.currency],
      set: { priceMinor: point.priceMinor, asOf: point.asOf, fetchedAt },
    });
}

/** Fetch + cache one asset's price — called right after a market asset is
 *  created/bound so it never sits valueless until the next app open. */
export async function refreshPriceFor(
  db: Db,
  asset: { class: string; symbol: string | null; providerId: string | null }
): Promise<boolean> {
  if (!asset.symbol) return false;
  const point =
    asset.class === 'CRYPTO'
      ? await fetchCryptoPrice(asset.symbol, asset.providerId)
      : await fetchEquityPrice(asset.symbol, asset.providerId);
  if (!point) return false;
  await upsertPrice(db, point);
  return true;
}

/** Write a price we ALREADY hold (the binding gate's test-fetch result)
 *  straight into the cache — no second network round-trip. */
export async function primePrice(
  db: Db,
  point: { symbol: string; currency: string; priceMinor: number }
): Promise<void> {
  await upsertPrice(db, { ...point, asOf: new Date().toISOString() });
}

export async function refreshPrices(db: Db): Promise<{ updated: string[]; failed: string[] }> {
  const all = await db.select().from(assets);
  const updated: string[] = [];
  const failed: string[] = [];

  for (const asset of all) {
    if (!isMarketPriced(asset.class) || !asset.symbol) continue;
    if (await refreshPriceFor(db, asset)) updated.push(asset.symbol);
    else failed.push(asset.symbol);
  }
  return { updated, failed };
}

export async function cachedPrice(db: Db, symbol: string) {
  const rows = await db.select().from(priceCache).where(eq(priceCache.symbol, symbol.toUpperCase()));
  return rows[0] ?? null;
}
