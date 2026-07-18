import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { assets, transactions, valuationMarks } from '@/db/schema';
import { nowISO, uuid } from '@/lib/uuid';

type NewAsset = Omit<typeof assets.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;

export async function createAsset(db: Db, values: NewAsset): Promise<string> {
  const id = uuid();
  const now = nowISO();
  await db.insert(assets).values({ id, createdAt: now, updatedAt: now, ...values });
  return id;
}

export async function listAssets(db: Db) {
  return db.select().from(assets);
}

export async function getAsset(db: Db, id: string) {
  const rows = await db.select().from(assets).where(eq(assets.id, id));
  return rows[0] ?? null;
}

export async function transactionsFor(db: Db, assetId: string) {
  return db.select().from(transactions).where(eq(transactions.assetId, assetId));
}

export async function valuationMarksFor(db: Db, assetId: string) {
  return db.select().from(valuationMarks).where(eq(valuationMarks.assetId, assetId));
}
