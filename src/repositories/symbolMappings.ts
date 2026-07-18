import { and, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { symbolMappings } from '@/db/schema';
import type { Binding } from '@/domain/symbols/resolver';
import { cacheKeysFor } from '@/domain/symbols/resolver';
import { normalizeKey } from '@/domain/symbols/search';
import { nowISO, uuid } from '@/lib/uuid';

export async function getMapping(
  db: Db,
  key: string,
  cls: Binding['class']
): Promise<Binding | null> {
  const rows = await db
    .select()
    .from(symbolMappings)
    .where(and(eq(symbolMappings.key, normalizeKey(key)), eq(symbolMappings.class, cls)));
  const row = rows[0];
  if (!row) return null;
  return {
    displayName: row.displayName,
    symbol: row.symbol,
    class: row.class,
    providerId: row.providerId,
    currency: row.currency,
  };
}

/** Persist a binding under every key it should be reachable by. */
export async function saveMapping(
  db: Db,
  binding: Binding,
  source: 'index' | 'ai' | 'manual',
  originalQuery?: string
): Promise<void> {
  const now = nowISO();
  for (const key of cacheKeysFor(binding, originalQuery)) {
    await db
      .insert(symbolMappings)
      .values({
        id: uuid(),
        key,
        class: binding.class,
        displayName: binding.displayName,
        symbol: binding.symbol,
        providerId: binding.providerId,
        currency: binding.currency,
        source,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
}

/** Preload the whole cache for one class as a resolver CacheLookup map. */
export async function loadCacheLookup(db: Db): Promise<Map<string, Binding>> {
  const rows = await db.select().from(symbolMappings);
  const map = new Map<string, Binding>();
  for (const row of rows) {
    map.set(`${row.class}:${row.key}`, {
      displayName: row.displayName,
      symbol: row.symbol,
      class: row.class,
      providerId: row.providerId,
      currency: row.currency,
    });
  }
  return map;
}
