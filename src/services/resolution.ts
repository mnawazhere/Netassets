/**
 * The ONE market-asset resolution path (spec §6, 7B-2/7B-3). Manual entry
 * and CSV import both come through here, so a hand-added "Microsoft" and
 * an imported "MSFT" row can only land on one asset with one providerId.
 *
 * Trust is by match-strength (v10): exact/cached bindings apply silently;
 * a 'dominant' fuzzy match is returned as a CANDIDATE for the gate — this
 * module never auto-binds a hypothesis.
 */
import type { Db } from '@/db/client';
import { resolveAsset, type ExistingAsset } from '@/domain/ingestion/resolution';
import type { ParsedTransaction } from '@/domain/ingestion/types';
import type { BindingCandidate } from '@/domain/symbols/bindingGate';
import { resolveBinding, type Binding } from '@/domain/symbols/resolver';
import { normalizeKey } from '@/domain/symbols/search';
import { eq } from 'drizzle-orm';

import { assets } from '@/db/schema';
import { createAsset, listAssets } from '@/repositories/assets';
import { loadCacheLookup, saveMapping } from '@/repositories/symbolMappings';

type AssetHint = ParsedTransaction['asset'];
const MARKET = new Set(['EQUITY', 'CRYPTO', 'ETF']);

export function makeCacheLookup(cache: Map<string, Binding>) {
  return (key: string, cls: Binding['class']): Binding | null =>
    cache.get(`${cls}:${normalizeKey(key)}`) ?? null;
}

export interface BindResult {
  hint: AssetHint;
  /** Present when the only resolution was a fuzzy hypothesis (§6 v10). */
  dominantCandidate: BindingCandidate | null;
}

/**
 * Enrich a market hint via the shared resolver. Exact/cached matches bind
 * into the hint; a dominant match is returned as a candidate for the
 * confirmation gate, with the hint left untouched. Misses pass through.
 */
export function bindHint(hint: AssetHint, cache: Map<string, Binding>): BindResult {
  if (!MARKET.has(hint.class) || hint.providerId) return { hint, dominantCandidate: null };
  const key = hint.symbol?.trim() || hint.name?.trim();
  if (!key) return { hint, dominantCandidate: null };

  const resolved = resolveBinding(key, hint.class as Binding['class'], makeCacheLookup(cache));
  if (!resolved) return { hint, dominantCandidate: null };

  if (resolved.match === 'dominant') {
    return {
      hint,
      dominantCandidate: {
        binding: resolved.binding,
        origin: 'index-dominant',
        forQuery: key,
      },
    };
  }

  return {
    hint: {
      ...hint,
      name: resolved.binding.displayName,
      symbol: resolved.binding.symbol,
      providerId: resolved.binding.providerId,
      currency: resolved.binding.currency,
    },
    dominantCandidate: null,
  };
}

export type EnsureOutcome =
  | { outcome: 'resolved'; assetId: string; bound: boolean; created: boolean }
  | { outcome: 'needs-confirmation'; candidate: BindingCandidate };

export interface EnsureOpts {
  /** 'confirm' (default): a dominant hypothesis returns needs-confirmation.
   *  'unpriced': the user already declined it — create unbound. */
  onDominant?: 'confirm' | 'unpriced';
  /** Provenance for the cached mapping when the hint carries a binding. */
  mappingSource?: 'index' | 'ai';
  /** Allow a name-only market hint to create an UNPRICED asset (manual
   *  path); the CSV path keeps the Stage-5 symbol requirement. */
  allowUnpricedMarket?: boolean;
}

/**
 * Resolve-or-create for one asset hint. A dominant-only resolution does
 * NOT create anything by default — it returns the candidate so the caller
 * can run the gate (test-fetch + confirm) and come back with a confirmed
 * binding in the hint (providerId set → exact path).
 */
export async function ensureAsset(
  db: Db,
  rawHint: AssetHint,
  opts: EnsureOpts = {}
): Promise<EnsureOutcome> {
  const onDominant = opts.onDominant ?? 'confirm';
  const cache = await loadCacheLookup(db);
  const { hint, dominantCandidate } = bindHint(rawHint, cache);
  const existing: ExistingAsset[] = await listAssets(db);
  const cls = hint.class;

  if (dominantCandidate) {
    // Already tracking the hypothesized security? Then it's not a
    // hypothesis — the earlier bind was the confirmation.
    const b = dominantCandidate.binding;
    const match = existing.find(
      (a) =>
        a.class === cls &&
        (normalizeKey(a.symbol ?? '') === normalizeKey(b.symbol) || a.providerId === b.providerId)
    );
    if (match) return { outcome: 'resolved', assetId: match.id, bound: true, created: false };
    if (onDominant === 'confirm') {
      return { outcome: 'needs-confirmation', candidate: dominantCandidate };
    }
  }

  // Name-only market hint that didn't bind: manual-unpriced path.
  if (MARKET.has(cls) && !hint.symbol?.trim() && !hint.providerId) {
    const name = hint.name?.trim();
    if (!name) throw new Error(`Market-priced ${cls} hint needs a symbol or a name`);
    if (!opts.allowUnpricedMarket) {
      throw new Error(`Market-priced ${cls} row needs a symbol to resolve`);
    }
    const match = existing.find(
      (a) => a.class === cls && normalizeKey(a.name) === normalizeKey(name)
    );
    if (match) return { outcome: 'resolved', assetId: match.id, bound: false, created: false };
    const assetId = await createAsset(db, {
      class: cls,
      name,
      symbol: null,
      platform: hint.platform ?? null,
      currency: hint.currency.toUpperCase(),
      providerId: null,
    });
    return { outcome: 'resolved', assetId, bound: false, created: true };
  }

  const resolution = resolveAsset(existing, hint);
  if (resolution.kind === 'existing') {
    return { outcome: 'resolved', assetId: resolution.assetId, bound: true, created: false };
  }

  const assetId = await createAsset(db, resolution.asset);
  const bound = resolution.asset.providerId != null;
  if (bound) {
    await saveMapping(
      db,
      {
        displayName: resolution.asset.name,
        symbol: resolution.asset.symbol!,
        class: cls as Binding['class'],
        providerId: resolution.asset.providerId!,
        currency: resolution.asset.currency,
      },
      opts.mappingSource ?? 'index',
      rawHint.symbol ?? rawHint.name ?? undefined
    );
  }
  return { outcome: 'resolved', assetId, bound, created: true };
}

/**
 * Apply a GATE-PASSED binding (bound state only) to an existing asset —
 * canonical name/symbol/providerId — and teach the cache every key that
 * led here. This is the single write path for confirmed hypotheses.
 */
export async function applyConfirmedBinding(
  db: Db,
  assetId: string,
  candidate: BindingCandidate
): Promise<void> {
  const { binding } = candidate;
  await db
    .update(assets)
    .set({
      name: binding.displayName,
      symbol: binding.symbol,
      providerId: binding.providerId,
      currency: binding.currency,
    })
    .where(eq(assets.id, assetId));
  await saveMapping(
    db,
    binding,
    candidate.origin === 'ai' ? 'ai' : 'index',
    candidate.forQuery
  );
}
