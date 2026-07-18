/**
 * THE Stage 5 acceptance test (spec §6): import a statement, snapshot the
 * numbers, import the identical file again — nothing may move. Runs against
 * real SQLite (better-sqlite3) through the real migrations, so the unique
 * index, FKs, and the full service path are all exercised.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { parseEtoroCsv } from '@/domain/ingestion/etoro';
import { pendingReviews, resolveReview } from '@/repositories/reviewQueue';
import { runImport, type ImportRequest } from './ingestion';

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

afterEach(() => {
  for (const h of openHandles) h.close();
  openHandles = [];
});

const ETORO_CSV = [
  'Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA',
  '15/01/2025 14:32:11,Open Position,AAPL/USD,1853.00,10,0.00,0.00,3147.00,3111001,Stocks,0.00',
  '15/01/2025 14:32:11,Fee,AAPL/USD,1.50,-,-1.50,0.00,3145.50,3111001,Stocks,0.00',
  '02/04/2025 10:05:00,Open Position,AAPL/USD,1005.50,5,0.00,0.00,2140.00,3222002,Stocks,0.00',
  '15/05/2025 09:00:00,Dividend,AAPL/USD,3.75,-,3.75,3.75,2143.75,3111001,Stocks,0.00',
].join('\n');

function etoroRequest(): ImportRequest {
  const parsed = parseEtoroCsv(ETORO_CSV);
  return {
    fileName: 'etoro-statement-2025-H1.csv',
    kind: 'csv',
    platform: 'eToro',
    sourceAccount: 'etoro',
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rows: parsed.transactions,
  };
}

async function snapshot(db: Db) {
  const txns = await db.select().from(schema.transactions);
  const assets = await db.select().from(schema.assets);
  return {
    txnCount: txns.length,
    assetCount: assets.length,
    totalFlow: txns.reduce((s, t) => s + t.amountMinor, 0),
  };
}

describe('runImport — end-to-end idempotency', () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it('imports a fresh eToro statement: one asset, four transactions', async () => {
    const summary = await runImport(db, etoroRequest());
    expect(summary).toMatchObject({
      inserted: 4,
      skippedExact: 0,
      queuedForReview: 0,
      assetsCreated: 1,
    });
  });

  it('THE test: re-importing the identical file changes NOTHING', async () => {
    await runImport(db, etoroRequest());
    const before = await snapshot(db);

    const second = await runImport(db, etoroRequest());

    expect(second.inserted).toBe(0);
    expect(second.skippedExact).toBe(4); // strong keys: silent no-op
    expect(second.queuedForReview).toBe(0);
    expect(second.assetsCreated).toBe(0);
    expect(await snapshot(db)).toEqual(before); // ← net worth inputs unmoved
    expect(second.coverage.overlaps).toHaveLength(1); // and the overlap was flagged
  });

  it('ID-less rows: re-import inside the covered window skips silently', async () => {
    const rows = parseEtoroCsv(ETORO_CSV).transactions.map((t) => ({ ...t, sourceTxnId: null }));
    const req = { ...etoroRequest(), rows };
    await runImport(db, req);
    const before = await snapshot(db);

    const second = await runImport(db, req);
    expect(second.inserted).toBe(0);
    expect(second.skippedExact).toBe(4);
    expect(second.queuedForReview).toBe(0);
    expect(await snapshot(db)).toEqual(before);
  });

  it('ID-less identical same-day trade with NO coverage → review queue, not dropped, not duped', async () => {
    const buy = {
      asset: { symbol: 'AAPL', name: 'AAPL', class: 'EQUITY' as const, platform: 'eToro', currency: 'USD' },
      type: 'BUY' as const,
      date: '2025-06-10',
      amountMinor: -100000,
      currency: 'USD',
      quantity: 5,
      sourceAccount: 'etoro',
      sourceTxnId: null,
    };
    // Two voice-captured identical buys, no statement window either time.
    await runImport(db, { fileName: 'voice-1', kind: 'voice', sourceAccount: 'etoro', rows: [buy] });
    const second = await runImport(db, { fileName: 'voice-2', kind: 'voice', sourceAccount: 'etoro', rows: [buy] });

    expect(second.inserted).toBe(0);
    expect(second.queuedForReview).toBe(1);

    const pending = await pendingReviews(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].reason).toBe('weak-collision');

    // One-tap "keep" → it really was a second box: now two transactions.
    await resolveReview(db, pending[0].id, 'kept');
    expect((await snapshot(db)).txnCount).toBe(2);
    // And resolving is idempotent-guarded.
    await expect(resolveReview(db, pending[0].id, 'kept')).rejects.toThrow(/already/);
  });

  it('rounding diff between exports → near-match review; merge fixes in place', async () => {
    const base = etoroRequest();
    await runImport(db, base);

    const rounded = parseEtoroCsv(ETORO_CSV).transactions.map((t) => ({
      ...t,
      sourceTxnId: null,
      amountMinor: t.amountMinor + (t.type === 'BUY' && t.date === '2025-01-15' ? -1 : 0),
    }));
    // Only the changed row survives dedup scrutiny; the identical ones skip via coverage.
    const second = await runImport(db, { ...base, fileName: 're-export.csv', rows: rounded });
    expect(second.queuedForReview).toBe(1);

    const pending = await pendingReviews(db);
    expect(pending[0].reason).toBe('near-match');

    await resolveReview(db, pending[0].id, 'merged');
    const txns = await db.select().from(schema.transactions);
    const buy = txns.find((t) => t.date === '2025-01-15' && t.type === 'BUY')!;
    expect(buy.amountMinor).toBe(-185301); // merged amount, corrected in place
    expect((await snapshot(db)).txnCount).toBe(4); // still four rows
  });
});
