import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { settings, type ChangeSource } from '@/db/schema';
import { nowISO, uuid } from '@/lib/uuid';

import { logChange } from './changeLog';

export const SETTING_KEYS = {
  hourlyRateMinor: 'hourly_rate_minor',
  hourlyRateCurrency: 'hourly_rate_currency',
  baseCurrency: 'base_currency',
} as const;

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  return rows[0]?.value ?? null;
}

/** Upsert a setting; every change is audit-logged (hourly rate especially). */
export async function setSetting(
  db: Db,
  key: string,
  value: string,
  source: ChangeSource
): Promise<void> {
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  const existing = rows[0];
  if (existing) {
    if (existing.value === value) return;
    await db
      .update(settings)
      .set({ value, updatedAt: nowISO() })
      .where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ id: uuid(), key, value, updatedAt: nowISO() });
  }
  await logChange(db, {
    entity: 'settings',
    entityId: key,
    field: 'value',
    oldValue: existing?.value ?? null,
    newValue: value,
    source,
  });
}
