import { and, desc, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { changeLog, type ChangeSource } from '@/db/schema';
import { nowISO, uuid } from '@/lib/uuid';

export interface ChangeEntry {
  entity: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  source: ChangeSource;
}

/** Append one audit row. Call for EVERY manually-set number (spec §7). */
export async function logChange(db: Db, entry: ChangeEntry): Promise<void> {
  await db.insert(changeLog).values({ id: uuid(), timestamp: nowISO(), ...entry });
}

export async function logChanges(db: Db, entries: ChangeEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const timestamp = nowISO();
  await db
    .insert(changeLog)
    .values(entries.map((e) => ({ id: uuid(), timestamp, ...e })));
}

/** History for one entity, newest first — powers the property value chart. */
export async function changesFor(db: Db, entity: string, entityId: string) {
  return db
    .select()
    .from(changeLog)
    .where(and(eq(changeLog.entity, entity), eq(changeLog.entityId, entityId)))
    .orderBy(desc(changeLog.timestamp));
}
