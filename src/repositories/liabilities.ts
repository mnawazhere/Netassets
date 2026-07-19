import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { liabilities } from '@/db/schema';
import { nowISO, uuid } from '@/lib/uuid';

type NewLiability = Omit<typeof liabilities.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;

export async function createLiability(db: Db, values: NewLiability): Promise<string> {
  const id = uuid();
  const now = nowISO();
  await db.insert(liabilities).values({ id, createdAt: now, updatedAt: now, ...values });
  return id;
}

export async function listLiabilities(db: Db) {
  return db.select().from(liabilities);
}

export async function getLiability(db: Db, id: string) {
  const rows = await db.select().from(liabilities).where(eq(liabilities.id, id));
  return rows[0] ?? null;
}

/** Record a new confirmed balance (a payment, a statement) — the ONLY
 *  mutable business field. `asOf` marks when the figure was confirmed so a
 *  months-old balance can be surfaced as stale. */
export async function updateOutstanding(
  db: Db,
  id: string,
  outstandingMinor: number,
  asOf: string
): Promise<void> {
  await db
    .update(liabilities)
    .set({ outstandingMinor, asOf, updatedAt: nowISO() })
    .where(eq(liabilities.id, id));
}

export async function deleteLiability(db: Db, id: string): Promise<void> {
  await db.delete(liabilities).where(eq(liabilities.id, id));
}
