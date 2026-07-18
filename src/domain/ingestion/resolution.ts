/**
 * Asset resolution — STEP ONE of ingestion, always before fingerprinting
 * (spec §6): a re-imported eToro row must land on the existing AAPL asset
 * or dedup never fires and duplicates get minted.
 *
 * Market-priced classes resolve by symbol + class (one asset per ticker;
 * positions on different accounts stay distinguishable via each txn's
 * source_account — spec §3.1 multi-account model). Property/collectibles
 * resolve by normalized name.
 */
import type { ParsedTransaction } from './types';

export interface ExistingAsset {
  id: string;
  class: string;
  name: string;
  symbol: string | null;
  platform: string | null;
  providerId?: string | null;
}

export type Resolution =
  | { kind: 'existing'; assetId: string }
  | {
      kind: 'create';
      asset: {
        class: ParsedTransaction['asset']['class'];
        name: string;
        symbol: string | null;
        platform: string | null;
        currency: string;
        providerId: string | null;
      };
    };

const MARKET_CLASSES = new Set(['EQUITY', 'CRYPTO', 'ETF']);

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toUpperCase();
}

export function resolveAsset(existing: ExistingAsset[], hint: ParsedTransaction['asset']): Resolution {
  if (MARKET_CLASSES.has(hint.class)) {
    const symbol = norm(hint.symbol);
    if (!symbol) throw new Error(`Market-priced ${hint.class} row needs a symbol to resolve`);
    // One security = one asset: match on canonical symbol, or on the
    // provider pricing id when both sides carry one (the stronger key).
    const match = existing.find(
      (a) =>
        a.class === hint.class &&
        (norm(a.symbol) === symbol ||
          (hint.providerId != null && a.providerId != null && a.providerId === hint.providerId))
    );
    if (match) return { kind: 'existing', assetId: match.id };
    return {
      kind: 'create',
      asset: {
        class: hint.class,
        name: hint.name?.trim() || symbol,
        symbol,
        platform: hint.platform ?? null,
        currency: hint.currency.toUpperCase(),
        providerId: hint.providerId ?? null,
      },
    };
  }

  const name = norm(hint.name);
  if (!name) throw new Error(`${hint.class} row needs a name to resolve`);
  const match = existing.find((a) => a.class === hint.class && norm(a.name) === name);
  if (match) return { kind: 'existing', assetId: match.id };
  return {
    kind: 'create',
    asset: {
      class: hint.class,
      name: hint.name!.trim(),
      symbol: null,
      platform: hint.platform ?? null,
      currency: hint.currency.toUpperCase(),
      providerId: null,
    },
  };
}
