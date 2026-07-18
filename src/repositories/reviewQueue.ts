import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { reviewItems } from '@/db/schema';
import type { ParsedTransaction } from '@/domain/ingestion/types';
import { nowISO, uuid } from '@/lib/uuid';

import { insertTransaction, updateTransactionAmount } from './transactions';

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

export async function pendingReviews(db: Db) {
  return db.select().from(reviewItems).where(eq(reviewItems.status, 'pending'));
}

/**
 * One-tap resolution (spec §6):
 * - keep: it's a real second transaction → insert it.
 * - discard: it's a duplicate → drop the incoming row.
 * - merge: same trade, better number → update the existing row's amount.
 * All paths mark the item resolved; keep/merge write change_log via the
 * transactions repository.
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

  const payload = JSON.parse(item.payload) as ParsedTransaction;

  if (decision === 'kept') {
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
  } else if (decision === 'merged') {
    if (!item.conflictsWith) throw new Error('merge needs a conflicting transaction');
    await updateTransactionAmount(db, item.conflictsWith, payload.amountMinor, 'manual');
  }

  await db
    .update(reviewItems)
    .set({ status: decision, resolvedAt: nowISO() })
    .where(eq(reviewItems.id, id));
}
