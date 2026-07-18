/**
 * 7B-3 acceptance (spec §6 v10): the gates are structural, with mocks
 * proving each one. Real SQLite through the real migrations.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import type { BindingCandidate } from '@/domain/symbols/bindingGate';
import { pendingReviews, resolveReview } from '@/repositories/reviewQueue';
import { aiFallback, confirmCandidate, prepareManualBinding, verifyCandidate } from './bindingFlow';
import { runImport } from './ingestion';
import { ensureAsset } from './resolution';

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
  return drizzle(sqlite, { schema }) as unknown as Db;
}

afterEach(() => {
  for (const h of openHandles) h.close();
  openHandles = [];
});

// Ferrari is deliberately NOT in the bundled index — a true miss that
// only the AI path can resolve.
const ferrariCandidate: BindingCandidate = {
  binding: {
    displayName: 'Ferrari N.V.',
    symbol: 'RACE',
    class: 'EQUITY',
    providerId: 'race.us',
    currency: 'USD',
  },
  origin: 'ai',
  confidence: 0.92,
  forQuery: 'Ferrari',
};

describe('7B-3 acceptance — AI fallback gates', () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it('an AI proposal that FAILS the test-fetch routes to manual-unpriced', async () => {
    const proposer = jest.fn(async () => ferrariCandidate);
    const outcome = await aiFallback(db, 'Ferrari', 'EQUITY', {
      proposer,
      testFetch: async () => null, // provider says: symbol does not price
      aiEnabled: async () => true,
    });
    expect(outcome).toEqual({ outcome: 'unpriced', reason: 'test-fetch-failed' });
    // Nothing bound, nothing cached.
    expect(await db.select().from(schema.symbolMappings)).toHaveLength(0);
  });

  it('a passing test-fetch is STILL pending — confirmation is the second mandatory gate', async () => {
    const outcome = await aiFallback(db, 'Ferrari', 'EQUITY', {
      proposer: async () => ferrariCandidate,
      testFetch: async () => 11250,
      aiEnabled: async () => true,
    });
    if (outcome.outcome !== 'awaiting-confirmation') throw new Error('expected verified');
    expect(outcome.gate.state).toBe('verified'); // NOT bound
    expect(await db.select().from(schema.symbolMappings)).toHaveLength(0); // nothing cached yet
    expect(await db.select().from(schema.assets)).toHaveLength(0); // nothing created
  });

  it('confirmed mapping caches; the second lookup never calls the AI', async () => {
    const proposer = jest.fn(async () => ferrariCandidate);
    const deps = { proposer, testFetch: async () => 11250, aiEnabled: async () => true };

    // First lookup: miss → AI → verified → user confirms → bind + cache.
    const first = await prepareManualBinding(
      db,
      { name: 'Ferrari', symbol: null, class: 'EQUITY', platform: null, currency: 'USD' },
      deps
    );
    if (first.kind !== 'confirm') throw new Error('expected confirm');
    expect(proposer).toHaveBeenCalledTimes(1);
    expect(confirmCandidate({ state: 'verified', candidate: first.pending.candidate, fetchedPriceMinor: first.pending.fetchedPriceMinor }, true).state).toBe('bound');
    const b = first.pending.candidate.binding;
    await ensureAsset(
      db,
      { name: b.displayName, symbol: b.symbol, class: 'EQUITY', platform: null, currency: b.currency, providerId: b.providerId },
      { mappingSource: 'ai' }
    );
    const mappings = await db.select().from(schema.symbolMappings);
    expect(mappings.length).toBeGreaterThan(0);
    expect(mappings.every((m) => m.source === 'ai')).toBe(true);

    // Second lookup for the same free text: cache hit, AI silent.
    const second = await prepareManualBinding(
      db,
      { name: 'ferrari n.v.', symbol: null, class: 'EQUITY', platform: null, currency: 'USD' },
      deps
    );
    expect(second.kind).toBe('ready');
    expect(proposer).toHaveBeenCalledTimes(1); // ← no second call
  });

  it('cloud toggle off → AI never fires', async () => {
    const proposer = jest.fn(async () => ferrariCandidate);
    const outcome = await aiFallback(db, 'Ferrari', 'EQUITY', {
      proposer,
      testFetch: async () => 11250,
      aiEnabled: async () => false,
    });
    expect(outcome).toEqual({ outcome: 'unpriced', reason: 'ai-disabled' });
    expect(proposer).not.toHaveBeenCalled();
  });

  it('low-confidence proposal is rejected before the test-fetch is even attempted', async () => {
    const testFetch = jest.fn(async () => 11250);
    const outcome = await aiFallback(db, 'Ferrari', 'EQUITY', {
      proposer: async () => ({ ...ferrariCandidate, confidence: 0.2 }),
      testFetch,
      aiEnabled: async () => true,
    });
    expect(outcome).toEqual({ outcome: 'unpriced', reason: 'low-confidence' });
    expect(testFetch).not.toHaveBeenCalled();
  });
});

describe('7B-3 acceptance — dominant import matches ride the same gate', () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  const fuzzyRow = {
    // 'MICROSOFT' is not an index SYMBOL — it dominant-matches the name.
    asset: { symbol: 'MICROSOFT', name: 'MICROSOFT', class: 'EQUITY' as const, platform: 'eToro', currency: 'USD' },
    type: 'BUY' as const,
    date: '2025-06-10',
    amountMinor: -412000,
    currency: 'USD',
    quantity: 10,
    sourceAccount: 'etoro',
    sourceTxnId: 'ETORO-7001',
  };

  it('dominant match on import → asset UNPRICED + review-queue confirmation, never auto-priced', async () => {
    await runImport(
      db,
      { fileName: 'fuzzy.csv', kind: 'csv', sourceAccount: 'etoro', rows: [fuzzyRow] },
      { testFetch: async () => 41200, refreshPrice: async () => false }
    );

    const [asset] = await db.select().from(schema.assets);
    expect(asset.providerId).toBeNull(); // NOT priced by the hypothesis

    const pending = await pendingReviews(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].reason).toBe('binding-confirm');

    // One-tap confirm → NOW it binds, and the cache learns it.
    await resolveReview(db, pending[0].id, 'kept');
    const [bound] = await db.select().from(schema.assets);
    expect(bound).toMatchObject({ name: 'Microsoft Corporation', symbol: 'MSFT', providerId: 'msft.us' });
    expect((await db.select().from(schema.symbolMappings)).length).toBeGreaterThan(0);
  });

  it('rejecting the card leaves the asset unpriced (right-symbol-wrong-entity guard)', async () => {
    await runImport(
      db,
      { fileName: 'fuzzy.csv', kind: 'csv', sourceAccount: 'etoro', rows: [fuzzyRow] },
      { testFetch: async () => 41200, refreshPrice: async () => false }
    );
    const pending = await pendingReviews(db);
    await resolveReview(db, pending[0].id, 'discarded');
    const [asset] = await db.select().from(schema.assets);
    expect(asset.providerId).toBeNull();
    expect(await db.select().from(schema.symbolMappings)).toHaveLength(0);
  });

  it('dominant match whose test-fetch FAILS never even queues — straight to unpriced', async () => {
    await runImport(
      db,
      { fileName: 'fuzzy.csv', kind: 'csv', sourceAccount: 'etoro', rows: [fuzzyRow] },
      { testFetch: async () => null, refreshPrice: async () => false }
    );
    expect(await pendingReviews(db)).toHaveLength(0);
    const [asset] = await db.select().from(schema.assets);
    expect(asset.providerId).toBeNull();
    // The transaction itself still landed — capture is never blocked.
    expect(await db.select().from(schema.transactions)).toHaveLength(1);
  });
});
