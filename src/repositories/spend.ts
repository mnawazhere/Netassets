import { desc, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { spendEntries, type ChangeSource } from '@/db/schema';
import { nowISO, uuid } from '@/lib/uuid';

export async function addSpendEntry(
  db: Db,
  values: { month: string; amountMinor: number; currency: string; source: ChangeSource; note?: string | null }
): Promise<string> {
  const id = uuid();
  const now = nowISO();
  await db
    .insert(spendEntries)
    .values({ id, createdAt: now, updatedAt: now, note: values.note ?? null, ...values });
  return id;
}

export async function listSpendEntries(db: Db) {
  return db.select().from(spendEntries).orderBy(desc(spendEntries.month));
}

export async function deleteSpendEntry(db: Db, id: string): Promise<void> {
  await db.delete(spendEntries).where(eq(spendEntries.id, id));
}
