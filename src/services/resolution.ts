/**
 * The ONE market-asset resolution path (spec §6, 7B-2). Manual entry and
 * CSV import both come through here, so a hand-added "Microsoft" and an
 * imported "MSFT" row can only land on one asset with one providerId.
 */
import type { Db } from '@/db/client';
import { resolveAsset, type ExistingAsset } from '@/domain/ingestion/resolution';
import type { ParsedTransaction } from '@/domain/ingestion/types';
import { resolveBinding, type Binding } from '@/domain/symbols/resolver';
import { normalizeKey } from '@/domain/symbols/search';
import { createAsset, listAssets } from '@/repositories/assets';
import { loadCacheLookup, saveMapping } from '@/repositories/symbolMappings';

type AssetHint = ParsedTransaction['asset'];
const MARKET = new Set(['EQUITY', 'CRYPTO', 'ETF']);

export function makeCacheLookup(cache: Map<string, Binding>) {
  return (key: string, cls: Binding['class']): Binding | null =>
    cache.get(`${cls}:${normalizeKey(key)}`) ?? null;
}

/**
 * Enrich a market hint with a binding from the shared resolver (index →
 * cache). A miss returns the hint unchanged — the unpriced/AI-fallback
 * path, decided by the caller. Non-market hints pass straight through.
 */
export function bindHint(hint: AssetHint, cache: Map<string, Binding>): AssetHint {
  if (!MARKET.has(hint.class) || hint.providerId) return hint;
  const key = hint.symbol?.trim() || hint.name?.trim();
  if (!key) return hint;
  const binding = resolveBinding(key, hint.class as Binding['class'], makeCacheLookup(cache));
  if (!binding) return hint;
  return {
    ...hint,
    name: binding.displayName,
    symbol: binding.symbol,
    providerId: binding.providerId,
    currency: binding.currency,
  };
}

/**
 * Resolve-or-create for one market/other asset hint. When a newly created
 * asset carries a binding, the mapping cache learns every key that led to
 * it — including the user's original free text.
 */
export async function ensureAsset(
  db: Db,
  rawHint: AssetHint
): Promise<{ assetId: string; bound: boolean; created: boolean }> {
  const cache = await loadCacheLookup(db);
  const hint = bindHint(rawHint, cache);
  const existing: ExistingAsset[] = await listAssets(db);
  const resolution = resolveAsset(existing, hint);

  if (resolution.kind === 'existing') {
    return { assetId: resolution.assetId, bound: true, created: false };
  }

  const assetId = await createAsset(db, resolution.asset);
  const bound = resolution.asset.providerId != null;
  if (bound) {
    await saveMapping(
      db,
      {
        displayName: resolution.asset.name,
        symbol: resolution.asset.symbol!,
        class: hint.class as Binding['class'],
        providerId: resolution.asset.providerId!,
        currency: resolution.asset.currency,
      },
      'index',
      rawHint.symbol ?? rawHint.name ?? undefined
    );
  }
  return { assetId, bound, created: true };
}
