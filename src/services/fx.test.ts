/** backfillHistoricalRates guards (spec §8): dates the provider can never
 *  serve must not be refetched on every refresh, and an offline pass must
 *  abort instead of stacking per-date fetch timeouts. Runs against real
 *  SQLite (better-sqlite3) with the network mocked at global fetch. */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { backfillHistoricalRates, getRateSeries, resetFxMissCache } from './fx';

const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

let openHandles: Database.Database[] = [];

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  openHandles.push(sqlite);
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync(join(MIGRATIONS_DIR, file), 'utf8').split('--> statement-breakpoint')) {
      sqlite.exec(stmt);
    }
  }
  // Same drizzle query API as the expo driver; the cast bridges the two
  // driver types for tests only.
  return drizzle(sqlite, { schema }) as unknown as Db;
}

async function seedEurTransactions(db: Db, dates: string[]) {
  await db.insert(schema.assets).values({
    id: 'asset-1',
    class: 'EQUITY',
    name: 'EU Stock',
    currency: 'EUR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  await db.insert(schema.transactions).values(
    dates.map((date, i) => ({
      id: `txn-${i}`,
      assetId: 'asset-1',
      type: 'BUY' as const,
      date,
      amountMinor: -1000,
      currency: 'EUR',
      fingerprint: `fp-${i}`,
      createdAt: '2026-01-01T00:00:00Z',
    }))
  );
}

/** Mock the exchange-api hosts: dates in `missing` 404 on both hosts. */
function mockFxFetch(missing: string[]) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const date = /(\d{4}-\d{2}-\d{2})/.exec(url)?.[1] ?? 'latest';
    if (missing.includes(date)) return Promise.resolve({ ok: false } as Response);
    return Promise.resolve({
      ok: true,
      json: async () => ({ date, eur: { aed: 3.97 } }),
    } as Response);
  });
}

beforeEach(() => {
  resetFxMissCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const h of openHandles) h.close();
  openHandles = [];
});

describe('backfillHistoricalRates', () => {
  it('never fetches dates before the provider history floor', async () => {
    const db = makeDb();
    await seedEurTransactions(db, ['2023-06-15', '2025-01-10']);
    const spy = mockFxFetch([]);

    await backfillHistoricalRates(db, 'AED');

    expect(spy.mock.calls.map((c) => String(c[0]))).not.toEqual(
      expect.arrayContaining([expect.stringContaining('2023-06-15')])
    );
    const series = await getRateSeries(db, 'EUR', 'AED');
    expect(series.points.map((p) => p.date)).toEqual(['2025-01-10']);
  });

  it('negative-caches a provider miss once another fetch succeeded, so the next pass skips it', async () => {
    const db = makeDb();
    await seedEurTransactions(db, ['2025-01-10', '2025-01-11']);
    const spy = mockFxFetch(['2025-01-10']);

    await backfillHistoricalRates(db, 'AED');
    expect((await getRateSeries(db, 'EUR', 'AED')).points.map((p) => p.date)).toEqual([
      '2025-01-11',
    ]);

    spy.mockClear();
    await backfillHistoricalRates(db, 'AED');
    expect(spy).not.toHaveBeenCalled();
  });

  it('aborts after a run of consecutive failures instead of trying every date', async () => {
    const db = makeDb();
    const dates = Array.from({ length: 10 }, (_, i) => `2025-02-${String(i + 1).padStart(2, '0')}`);
    await seedEurTransactions(db, dates);
    const spy = mockFxFetch(dates);

    await backfillHistoricalRates(db, 'AED');

    // First concurrent chunk only (4 dates × 2 hosts), not 10 × 2.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(8);

    // Offline misses are NOT negative-cached — the next pass retries them.
    spy.mockClear();
    await backfillHistoricalRates(db, 'AED');
    expect(spy).toHaveBeenCalled();
  });
});
