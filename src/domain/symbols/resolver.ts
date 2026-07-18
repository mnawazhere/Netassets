/**
 * Shared binding resolver (spec §6, 7B-2): ONE path decides what a
 * market-class name/ticker binds to, used by BOTH manual entry and CSV
 * import — so a hand-added "Microsoft" and an imported "MSFT" can only
 * ever land on the same binding.
 *
 * Sources, in order:
 *  1. Bundled static index — exact symbol/name, or a UNIQUE dominant name
 *     match (curated canonical data; a unique strong match is a fact).
 *  2. Persisted mapping cache (normalized keys) — where confirmed AI
 *     bindings (7B-3) and past resolutions live.
 * Anything else is a MISS → the caller decides (AI fallback with gates,
 * or manual-unpriced). This module never guesses.
 */
import { lookupExact, normalizeKey, searchSymbols } from './search';
import type { SecurityEntry } from './types';

export interface Binding {
  displayName: string;
  symbol: string;
  class: SecurityEntry['class'];
  providerId: string;
  currency: string;
}

/** Lookup into the persisted cache; keys arrive already normalized. */
export type CacheLookup = (key: string, cls: SecurityEntry['class']) => Binding | null;

function toBinding(e: SecurityEntry): Binding {
  return {
    displayName: e.displayName,
    symbol: e.symbol,
    class: e.class,
    providerId: e.providerId,
    currency: e.currency,
  };
}

const DOMINANT_SCORE_RESULTS = 2; // ask for two so "unique" is provable

/**
 * Resolve a free-text key ("MSFT", "Microsoft", "Microsoft Corporation")
 * to a binding, or null on a miss. Casing/whitespace variants normalize
 * to the same key — same discipline as the Stage-5 resolver's norm().
 */
export function resolveBinding(
  key: string,
  cls: SecurityEntry['class'],
  cache: CacheLookup = () => null
): Binding | null {
  const q = normalizeKey(key);
  if (!q) return null;

  const exact = lookupExact(q, cls);
  if (exact) return toBinding(exact);

  const cached = cache(q, cls);
  if (cached) return cached;

  // Unique dominant index match: exactly one candidate at word/prefix
  // strength ("Microsoft" → Microsoft Corporation). Ambiguity = miss.
  const candidates = searchSymbols(q, { class: cls, limit: DOMINANT_SCORE_RESULTS });
  if (candidates.length === 1) {
    const only = candidates[0];
    const name = only.displayName.toUpperCase();
    if (name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))) {
      return toBinding(only);
    }
  }

  return null;
}

/** Cache keys a confirmed binding should be reachable by. */
export function cacheKeysFor(binding: Binding, originalQuery?: string): string[] {
  const keys = new Set<string>([normalizeKey(binding.symbol), normalizeKey(binding.displayName)]);
  if (originalQuery) keys.add(normalizeKey(originalQuery));
  return [...keys].filter(Boolean);
}
