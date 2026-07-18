import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { transactions, valuationMarks, type ChangeSource } from '@/db/schema';
import { fingerprint } from '@/domain/fingerprint';
import { nowISO, uuid } from '@/lib/uuid';

import { logChange } from './changeLog';

type NewTransaction = Omit<
  typeof transactions.$inferInsert,
  'id' | 'createdAt' | 'fingerprint'
>;

/**
 * Insert a transaction. The dedup fingerprint is always computed here (from
 * the already-resolved assetId) so no caller can write an unfingerprinted
 * row. Manual/voice entries are audit-logged.
 */
export async function insertTransaction(
  db: Db,
  values: NewTransaction,
  source: ChangeSource
): Promise<string> {
  const id = uuid();
  await db.insert(transactions).values({
    id,
    createdAt: nowISO(),
    fingerprint: fingerprint({
      assetId: values.assetId,
      date: values.date,
      type: values.type,
      quantity: values.quantity,
      amountMinor: values.amountMinor,
      sourceAccount: values.sourceAccount,
      sourceTxnId: values.sourceTxnId,
    }),
    ...values,
  });
  if (source === 'manual' || source === 'voice') {
    await logChange(db, {
      entity: 'transactions',
      entityId: id,
      field: 'amount_minor',
      oldValue: null,
      newValue: String(values.amountMinor),
      source,
    });
  }
  return id;
}

type NewValuationMark = Omit<typeof valuationMarks.$inferInsert, 'id' | 'createdAt'>;

/** Valuation marks are manually-set numbers by definition — always audited. */
export async function insertValuationMark(db: Db, values: NewValuationMark): Promise<string> {
  const id = uuid();
  await db.insert(valuationMarks).values({ id, createdAt: nowISO(), ...values });
  await logChange(db, {
    entity: 'valuation_marks',
    entityId: id,
    field: 'value_minor',
    oldValue: null,
    newValue: String(values.valueMinor),
    source: values.source,
  });
  return id;
}

/** Correct a transaction amount — audited (spec §7: "a corrected transaction"). */
export async function updateTransactionAmount(
  db: Db,
  id: string,
  amountMinor: number,
  source: ChangeSource
): Promise<void> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id));
  const existing = rows[0];
  if (!existing) throw new Error(`Transaction ${id} not found`);
  await db
    .update(transactions)
    .set({
      amountMinor,
      fingerprint: fingerprint({
        assetId: existing.assetId,
        date: existing.date,
        type: existing.type,
        quantity: existing.quantity,
        amountMinor,
        sourceAccount: existing.sourceAccount,
        sourceTxnId: existing.sourceTxnId,
      }),
    })
    .where(eq(transactions.id, id));
  await logChange(db, {
    entity: 'transactions',
    entityId: id,
    field: 'amount_minor',
    oldValue: String(existing.amountMinor),
    newValue: String(amountMinor),
    source,
  });
}
