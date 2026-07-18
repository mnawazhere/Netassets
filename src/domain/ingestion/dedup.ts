/**
 * Dedup planner (spec §6). Runs AFTER asset resolution, on fingerprinted
 * rows. Decides insert / skip-exact / review per row — the DB unique index
 * is the last line of defense, never the decision-maker.
 *
 * Rules:
 * - Strong-key (broker txn id) fingerprint match → skip-exact. True
 *   idempotency: the broker said it's the same row.
 * - Weak-key match, row's date inside a statement window already imported
 *   for the same account → skip-exact (presumed re-import; the coverage
 *   data exists precisely for this).
 * - Weak-key match outside coverage → review 'weak-collision' (could be a
 *   second real identical trade — never guess, never drop).
 * - No fingerprint match but same asset+date+type+quantity with amount
 *   within tolerance → review 'near-match' (rounding diffs between
 *   exports of the same trade).
 */
import { fingerprint } from '../fingerprint';
import type { CoveredRange, ExistingTxn, ImportAction, ParsedTransaction } from './types';

/** Rounding-diff tolerance: |Δamount| ≤ max(2 minor units, 0.5%). */
function isNearAmount(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff > 0 && diff <= Math.max(2, Math.abs(a) * 0.005);
}

function inCoveredRange(
  row: { date: string; sourceAccount?: string | null },
  ranges: CoveredRange[]
): boolean {
  return ranges.some(
    (r) =>
      (r.sourceAccount ?? null) === (row.sourceAccount ?? null) &&
      r.periodStart.localeCompare(row.date) <= 0 &&
      r.periodEnd.localeCompare(row.date) >= 0
  );
}

export interface PlanContext {
  existing: ExistingTxn[];
  /** Statement windows from prior imports (spec §6 coverage). */
  coveredRanges: CoveredRange[];
}

export function planRow(
  row: ParsedTransaction & { assetId: string },
  ctx: PlanContext
): ImportAction & { fingerprint: string } {
  const fp = fingerprint({
    assetId: row.assetId,
    date: row.date,
    type: row.type,
    quantity: row.quantity,
    amountMinor: row.amountMinor,
    sourceAccount: row.sourceAccount,
    sourceTxnId: row.sourceTxnId,
  });
  const strong = Boolean(row.sourceTxnId);

  const collision = ctx.existing.find((t) => t.fingerprint === fp);
  if (collision) {
    if (strong) return { action: 'skip-exact', reason: 'strong-key-match', fingerprint: fp };
    if (inCoveredRange(row, ctx.coveredRanges)) {
      return { action: 'skip-exact', reason: 'covered-weak-match', fingerprint: fp };
    }
    return {
      action: 'review',
      reason: 'weak-collision',
      conflictsWith: collision.id,
      fingerprint: fp,
    };
  }

  // A row with its own broker id and no fingerprint collision is a new
  // trade RELATIVE TO other id-keyed rows (two same-day fills, distinct
  // ids never collide) — but a prior import may have stored the SAME
  // trade id-less (voice/screenshot capture, weak fingerprint), so
  // strong rows still content-check against weak-keyed existing rows.
  // An existing row is weak-keyed iff its stored fingerprint equals the
  // no-id fingerprint of its own content.
  const isWeakKeyed = (t: ExistingTxn) =>
    t.fingerprint ===
    fingerprint({
      assetId: t.assetId,
      date: t.date,
      type: t.type,
      quantity: t.quantity,
      amountMinor: t.amountMinor,
      sourceAccount: t.sourceAccount,
      sourceTxnId: null,
    });
  const candidates = strong ? ctx.existing.filter(isWeakKeyed) : ctx.existing;

  const sameShape = (t: ExistingTxn) =>
    t.assetId === row.assetId &&
    t.type === row.type &&
    t.date === row.date &&
    (t.quantity ?? null) === (row.quantity ?? null) &&
    (t.sourceAccount ?? null) === (row.sourceAccount ?? null);

  const exactContent = candidates.find((t) => sameShape(t) && t.amountMinor === row.amountMinor);
  if (exactContent) {
    if (inCoveredRange(row, ctx.coveredRanges)) {
      return { action: 'skip-exact', reason: 'covered-weak-match', fingerprint: fp };
    }
    return {
      action: 'review',
      reason: 'weak-collision',
      conflictsWith: exactContent.id,
      fingerprint: fp,
    };
  }

  const near = candidates.find((t) => sameShape(t) && isNearAmount(t.amountMinor, row.amountMinor));
  if (near) {
    return { action: 'review', reason: 'near-match', conflictsWith: near.id, fingerprint: fp };
  }

  return { action: 'insert', fingerprint: fp };
}
