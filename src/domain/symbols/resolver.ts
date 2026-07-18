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

/**
 * Trust is by MATCH-STRENGTH, not source (spec §6 v10):
 * - 'exact'    — symbol/canonical-name index hit: a fact, auto-bind.
 * - 'cached'   — previously confirmed mapping: a fact, auto-bind.
 * - 'dominant' — unique fuzzy prefix match: a HYPOTHESIS. Same
 *   confirmation gate as an AI proposal ("Micro" binds Microsoft even if
 *   the user held Micron and Micron isn't in the curated index).
 */
export type MatchKind = 'exact' | 'cached' | 'dominant';

export interface ResolvedBinding {
  binding: Binding;
  match: MatchKind;
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
): ResolvedBinding | null {
  const q = normalizeKey(key);
  if (!q) return null;

  const exact = lookupExact(q, cls);
  if (exact) return { binding: toBinding(exact), match: 'exact' };

  const cached = cache(q, cls);
  if (cached) return { binding: cached, match: 'cached' };

  // Unique dominant index match: exactly one candidate at word/prefix
  // strength ("Microsoft" → Microsoft Corporation). Ambiguity = miss.
  // NOTE: 'dominant' is a hypothesis — callers must gate it (§6 v10).
  const candidates = searchSymbols(q, { class: cls, limit: DOMINANT_SCORE_RESULTS });
  if (candidates.length === 1) {
    const only = candidates[0];
    const name = only.displayName.toUpperCase();
    if (name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))) {
      return { binding: toBinding(only), match: 'dominant' };
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
