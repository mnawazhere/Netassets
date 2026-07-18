/** Offline typeahead over the bundled index (spec §6). Pure — no network,
 *  no db; instant and private by construction. */
import { CRYPTO_COINS } from './crypto';
import { US_EQUITIES, US_ETFS } from './equities';
import type { SecurityEntry } from './types';

export const SYMBOL_INDEX: SecurityEntry[] = [...US_EQUITIES, ...US_ETFS, ...CRYPTO_COINS];

/** Same normalization discipline as the Stage-5 resolver's norm(). */
export function normalizeKey(s: string): string {
  return s.trim().toUpperCase();
}

function score(entry: SecurityEntry, q: string): number {
  const symbol = entry.symbol.toUpperCase();
  const name = entry.displayName.toUpperCase();
  if (symbol === q) return 100;
  if (name === q) return 95;
  if (symbol.startsWith(q)) return 80;
  if (name.startsWith(q)) return 70;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 60;
  if (name.includes(q)) return 40;
  return 0;
}

export function searchSymbols(
  query: string,
  opts?: { class?: SecurityEntry['class']; limit?: number }
): SecurityEntry[] {
  const q = normalizeKey(query);
  if (!q) return [];
  const pool = opts?.class ? SYMBOL_INDEX.filter((e) => e.class === opts.class) : SYMBOL_INDEX;
  return pool
    .map((entry) => ({ entry, s: score(entry, q) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s || a.entry.symbol.localeCompare(b.entry.symbol))
    .slice(0, opts?.limit ?? 8)
    .map(({ entry }) => entry);
}

/** Exact lookup: symbol or full name, class-scoped. Used by the resolver. */
export function lookupExact(
  key: string,
  cls: SecurityEntry['class']
): SecurityEntry | null {
  const q = normalizeKey(key);
  return (
    SYMBOL_INDEX.find((e) => e.class === cls && e.symbol.toUpperCase() === q) ??
    SYMBOL_INDEX.find((e) => e.class === cls && e.displayName.toUpperCase() === q) ??
    null
  );
}
