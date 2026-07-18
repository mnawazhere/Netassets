/**
 * Regression: resolveReview's write pair (side effect, then status flip) is
 * not atomic — if the app dies between the two, the item stays 'pending'
 * while the side effect persists. A retry must then succeed idempotently:
 * 'kept' must not choke on transactions_fingerprint_uq (the synthesized
 * sourceTxnId is deterministic per item), and 'merged' must not write a
 * duplicate change_log audit row.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { parseEtoroCsv } from '@/domain/ingestion/etoro';
import { pendingReviews, resolveReview } from '@/repositories/reviewQueue';
import { insertTransaction, updateTransactionAmount } from '@/repositories/transactions';
import { runImport, type ImportRequest } from '@/services/ingestion';

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

const hermetic = { refreshPrice: async () => false };

const ETORO_CSV = [
  'Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA',
  '15/01/2025 14:32:11,Open Position,AAPL/USD,1853.00,10,0.00,0.00,3147.00,3111001,Stocks,0.00',
].join('\n');

function etoroRequest(): ImportRequest {
  const parsed = parseEtoroCsv(ETORO_CSV);
  return {
    fileName: 'etoro-statement.csv',
    kind: 'csv',
    platform: 'eToro',
    sourceAccount: 'etoro',
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rows: parsed.transactions,
  };
}

describe('resolveReview — retry after a crash between the side effect and the status flip', () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("'kept' retry survives the fingerprint unique index and resolves the item", async () => {
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
    await runImport(db, { fileName: 'voice-1', kind: 'voice', sourceAccount: 'etoro', rows: [buy] }, hermetic);
    await runImport(db, { fileName: 'voice-2', kind: 'voice', sourceAccount: 'etoro', rows: [buy] }, hermetic);

    const [item] = await pendingReviews(db);
    expect(item.reason).toBe('weak-collision');

    // Simulate the first 'keep' dying right after the insert committed:
    // the transaction row exists, the review item is still pending.
    await insertTransaction(
      db,
      {
        assetId: item.assetId,
        type: buy.type,
        date: buy.date,
        amountMinor: buy.amountMinor,
        currency: buy.currency,
        quantity: buy.quantity,
        hoursSpent: 0,
        sourceAccount: buy.sourceAccount,
        sourceTxnId: `review-kept:${item.id}`,
        sourceRef: item.importId,
        note: null,
      },
      'manual'
    );

    // The retry tap must not throw and must resolve the item…
    await resolveReview(db, item.id, 'kept');
    expect(await pendingReviews(db)).toHaveLength(0);

    // …without inserting the kept transaction a second time.
    const txns = await db.select().from(schema.transactions);
    expect(txns).toHaveLength(2);
  });

  it("'merged' retry does not write a duplicate change_log audit row", async () => {
    await runImport(db, etoroRequest(), hermetic);
    const rounded = parseEtoroCsv(ETORO_CSV).transactions.map((t) => ({
      ...t,
      sourceTxnId: null,
      amountMinor: t.amountMinor - 1,
    }));
    await runImport(db, { ...etoroRequest(), fileName: 're-export.csv', rows: rounded }, hermetic);

    const [item] = await pendingReviews(db);
    expect(item.reason).toBe('near-match');
    const targetId = item.conflictsWith!;

    // Simulate the first 'merge' dying right after the amount update
    // committed (audit row written), before the status flip.
    await updateTransactionAmount(db, targetId, rounded[0].amountMinor, 'manual');
    const auditBefore = await db
      .select()
      .from(schema.changeLog)
      .where(eq(schema.changeLog.entityId, targetId));

    await resolveReview(db, item.id, 'merged');
    expect(await pendingReviews(db)).toHaveLength(0);

    const [merged] = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, targetId));
    expect(merged.amountMinor).toBe(rounded[0].amountMinor);

    const auditAfter = await db
      .select()
      .from(schema.changeLog)
      .where(eq(schema.changeLog.entityId, targetId));
    expect(auditAfter).toHaveLength(auditBefore.length); // no duplicate entry
  });
});
