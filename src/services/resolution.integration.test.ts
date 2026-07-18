/**
 * 7B-2 acceptance (spec §6): the mirror of the Stage-5 dedup test — a
 * hand-added "Microsoft" and an imported eToro "MSFT" row must resolve to
 * ONE asset with ONE providerId, through the one shared resolver + cache.
 * Runs against real SQLite through the real migrations.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
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

const msftCsvRow = {
  asset: { symbol: 'MSFT', name: 'MSFT', class: 'EQUITY' as const, platform: 'eToro', currency: 'USD' },
  type: 'BUY' as const,
  date: '2025-06-10',
  amountMinor: -412000,
  currency: 'USD',
  quantity: 10,
  sourceAccount: 'etoro',
  sourceTxnId: 'ETORO-9001',
};

describe('7B-2 acceptance — one security, one asset, one providerId', () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it('hand-added free-text "Microsoft" then CSV "MSFT" → ONE asset, providerId msft.us', async () => {
    // Manual entry: user typed a name, no typeahead pick, no providerId.
    const manual = await ensureAsset(db, {
      name: 'Microsoft',
      symbol: null,
      class: 'EQUITY',
      platform: null,
      currency: 'USD',
      providerId: null,
    });
    expect(manual.created).toBe(true);
    expect(manual.bound).toBe(true);

    // CSV import of an eToro MSFT row — the other entry path.
    const summary = await runImport(db, {
      fileName: 'etoro.csv',
      kind: 'csv',
      platform: 'eToro',
      sourceAccount: 'etoro',
      rows: [msftCsvRow],
    });
    expect(summary.assetsCreated).toBe(0); // resolved to the existing asset

    const assets = await db.select().from(schema.assets);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      name: 'Microsoft Corporation', // canonical, not the free text
      symbol: 'MSFT',
      providerId: 'msft.us', // the ONE pricing id
    });

    const txns = await db.select().from(schema.transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].assetId).toBe(manual.assetId);
  });

  it('order-independent: CSV first, then hand-added "Microsoft" → still one asset', async () => {
    await runImport(db, {
      fileName: 'etoro.csv',
      kind: 'csv',
      sourceAccount: 'etoro',
      rows: [msftCsvRow],
    });
    const manual = await ensureAsset(db, {
      name: 'microsoft', // lowercase on purpose
      symbol: null,
      class: 'EQUITY',
      platform: null,
      currency: 'USD',
      providerId: null,
    });
    expect(manual.created).toBe(false);
    expect((await db.select().from(schema.assets))).toHaveLength(1);
  });

  it('cache keys normalize through norm(): casing/whitespace variants hit one binding', async () => {
    await ensureAsset(db, {
      name: 'Microsoft',
      symbol: null,
      class: 'EQUITY',
      platform: null,
      currency: 'USD',
      providerId: null,
    });
    for (const variant of ['  MICROSOFT  ', 'mSfT', 'Microsoft Corporation']) {
      const again = await ensureAsset(db, {
        name: variant,
        symbol: null,
        class: 'EQUITY',
        platform: null,
        currency: 'USD',
        providerId: null,
      });
      expect(again.created).toBe(false);
    }
    expect((await db.select().from(schema.assets))).toHaveLength(1);
    // The cache learned the original free text alongside the canonical keys.
    const keys = (await db.select().from(schema.symbolMappings)).map((m) => m.key).sort();
    expect(keys).toContain('MICROSOFT');
    expect(keys).toContain('MSFT');
    expect(keys).toContain('MICROSOFT CORPORATION');
  });

  it('index miss → unpriced asset (providerId null), flagged not blocked', async () => {
    const r = await ensureAsset(db, {
      name: 'Obscure Frontier Fund',
      symbol: 'OBSCF',
      class: 'EQUITY',
      platform: null,
      currency: 'USD',
      providerId: null,
    });
    expect(r.created).toBe(true);
    expect(r.bound).toBe(false);
    const [asset] = await db.select().from(schema.assets);
    expect(asset.providerId).toBeNull(); // the 7B-3 AI-fallback entry state
  });

  it('typeahead-bound manual asset seeds the cache for later imports', async () => {
    // Simulates a typeahead pick: binding already present.
    await ensureAsset(db, {
      name: 'NVIDIA Corporation',
      symbol: 'NVDA',
      class: 'EQUITY',
      platform: null,
      currency: 'USD',
      providerId: 'nvda.us',
    });
    const mappings = await db.select().from(schema.symbolMappings);
    expect(mappings.some((m) => m.key === 'NVDA' && m.providerId === 'nvda.us')).toBe(true);
  });
});
