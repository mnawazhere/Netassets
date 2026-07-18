import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { reviewItems, transactions } from '@/db/schema';
import type { ParsedTransaction } from '@/domain/ingestion/types';
import type { BindingCandidate } from '@/domain/symbols/bindingGate';
import { nowISO, uuid } from '@/lib/uuid';
import { applyConfirmedBinding } from '@/services/resolution';

import { insertTransaction, updateTransactionAmount } from './transactions';

/** Payload shape for reason='binding-confirm' items (spec §6 v10). */
export interface BindingReviewPayload {
  kind: 'binding-confirm';
  candidate: BindingCandidate;
  /** Price from the passed test-fetch — shown on the confirm card. */
  fetchedPriceMinor: number;
}

export async function enqueueReview(
  db: Db,
  entry: {
    importId: string;
    assetId: string;
    payload: ParsedTransaction;
    reason: 'weak-collision' | 'near-match';
    conflictsWith: string | null;
  }
): Promise<string> {
  const id = uuid();
  await db.insert(reviewItems).values({
    id,
    importId: entry.importId,
    assetId: entry.assetId,
    payload: JSON.stringify(entry.payload),
    reason: entry.reason,
    conflictsWith: entry.conflictsWith,
    createdAt: nowISO(),
  });
  return id;
}

/**
 * Queue a VERIFIED (test-fetch passed) but unconfirmed binding hypothesis
 * for the asset — the no-human import path's confirmation gate. The asset
 * stays unpriced until the user answers.
 */
export async function enqueueBindingReview(
  db: Db,
  entry: {
    importId: string;
    assetId: string;
    candidate: BindingCandidate;
    fetchedPriceMinor: number;
  }
): Promise<string> {
  const id = uuid();
  const payload: BindingReviewPayload = {
    kind: 'binding-confirm',
    candidate: entry.candidate,
    fetchedPriceMinor: entry.fetchedPriceMinor,
  };
  await db.insert(reviewItems).values({
    id,
    importId: entry.importId,
    assetId: entry.assetId,
    payload: JSON.stringify(payload),
    reason: 'binding-confirm',
    conflictsWith: null,
    createdAt: nowISO(),
  });
  return id;
}

export async function pendingReviews(db: Db) {
  return db.select().from(reviewItems).where(eq(reviewItems.status, 'pending'));
}

/** SQLite unique-constraint violation, same message text on every driver. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}

/**
 * One-tap resolution (spec §6):
 * - keep: it's a real second transaction → insert it.
 * - discard: it's a duplicate → drop the incoming row.
 * - merge: same trade, better number → update the existing row's amount.
 * All paths mark the item resolved; keep/merge write change_log via the
 * transactions repository.
 *
 * The write pair (side effect, then status flip) has no transaction around
 * it (the sqlite driver's transaction API takes a sync callback, which our
 * async repositories can't run inside), so each path is idempotent instead:
 * a retry after a crash between the two writes detects the already-applied
 * side effect and proceeds straight to marking the item resolved.
 */
export async function resolveReview(
  db: Db,
  id: string,
  decision: 'kept' | 'discarded' | 'merged'
): Promise<void> {
  const rows = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
  const item = rows[0];
  if (!item) throw new Error(`Review item ${id} not found`);
  if (item.status !== 'pending') throw new Error(`Review item ${id} already ${item.status}`);

  // Binding confirmations: kept = user confirmed the entity → bind + cache;
  // discarded = asset stays unpriced. Merge does not apply.
  if (item.reason === 'binding-confirm') {
    if (decision === 'merged') throw new Error('merge does not apply to a binding confirmation');
    if (decision === 'kept') {
      const payload = JSON.parse(item.payload) as BindingReviewPayload;
      await applyConfirmedBinding(db, item.assetId, payload.candidate, payload.fetchedPriceMinor);
    }
    await db
      .update(reviewItems)
      .set({ status: decision, resolvedAt: nowISO() })
      .where(eq(reviewItems.id, id));
    return;
  }

  const payload = JSON.parse(item.payload) as ParsedTransaction;

  if (decision === 'kept') {
    try {
      await insertTransaction(
        db,
        {
          assetId: item.assetId,
          type: payload.type,
          date: payload.date,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          quantity: payload.quantity ?? null,
          hoursSpent: payload.hoursSpent ?? 0,
          sourceAccount: payload.sourceAccount ?? null,
          // Disambiguate from the colliding row: a kept duplicate is a real,
          // distinct trade — synthesize a txn id so the fingerprint differs.
          sourceTxnId: payload.sourceTxnId ?? `review-kept:${id}`,
          sourceRef: item.importId,
          note: payload.note ?? null,
        },
        'manual'
      );
    } catch (err) {
      // A prior 'keep' that died before the status flip already inserted
      // this row — the deterministic sourceTxnId reproduces the identical
      // fingerprint, so the retry lands on transactions_fingerprint_uq.
      // The side effect exists; fall through and resolve the item.
      if (!isUniqueViolation(err)) throw err;
    }
  } else if (decision === 'merged') {
    if (!item.conflictsWith) throw new Error('merge needs a conflicting transaction');
    // Skip the write when a prior 'merge' already applied this amount but
    // died before the status flip — re-running would duplicate the audit row.
    const existing = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, item.conflictsWith));
    if (existing[0]?.amountMinor !== payload.amountMinor) {
      await updateTransactionAmount(db, item.conflictsWith, payload.amountMinor, 'manual');
    }
  }

  await db
    .update(reviewItems)
    .set({ status: decision, resolvedAt: nowISO() })
    .where(eq(reviewItems.id, id));
}
