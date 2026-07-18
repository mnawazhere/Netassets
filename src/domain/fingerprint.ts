/**
 * Transaction fingerprint for idempotent dedup (spec §6 v3).
 *
 * Two keys, in preference order:
 * 1. Broker/order ID when the statement provides one:
 *      hash(asset_id + source_account + source_txn_id)
 *    The only reliable idempotency key — survives re-imports AND keeps two
 *    genuinely identical same-day trades distinct.
 * 2. Fallback (no ID):
 *      hash(asset_id + date + type + quantity + amount + source_account)
 *    Cannot distinguish a re-import from two real identical trades, so a
 *    collision on this key must route to the review queue, never hard-fail.
 *
 * Asset resolution runs BEFORE fingerprinting — the asset_id here must be
 * the resolved asset, or re-imports would mint new assets and never dedup.
 *
 * FNV-1a 64-bit over a canonical field string: stable, dependency-free,
 * and identical across JS engines (Hermes/Node).
 */

export interface FingerprintInput {
  assetId: string;
  /** ISO YYYY-MM-DD */
  date: string;
  type: string;
  quantity: number | null | undefined;
  amountMinor: number;
  sourceAccount: string | null | undefined;
  /** Broker/order transaction ID from the statement, when provided. */
  sourceTxnId?: string | null;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export function canonicalFingerprintString(t: FingerprintInput): string {
  if (t.sourceTxnId) {
    return ['id', t.assetId, t.sourceAccount ?? '', t.sourceTxnId].join('|');
  }
  return [
    t.assetId,
    t.date,
    t.type,
    t.quantity ?? '',
    t.amountMinor,
    t.sourceAccount ?? '',
  ].join('|');
}

export function fingerprint(t: FingerprintInput): string {
  return fnv1a64(canonicalFingerprintString(t));
}

/** True when this fingerprint is the weak (no broker ID) variant — a
 *  collision on it is ambiguous and belongs in the review queue. */
export function isFallbackFingerprint(t: FingerprintInput): boolean {
  return !t.sourceTxnId;
}
