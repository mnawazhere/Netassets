/**
 * computePortfolioView degradation tests (spec §8: outages degrade to
 * stale/unvalued, never a throw, never a silent wrong conversion):
 *  - an EMPTY fx series (pair never fetched) renders the asset unvalued
 *    instead of crashing rateOn() and hanging the dashboard;
 *  - USD→AED falls back to the hardcoded peg when no rate was ever cached;
 *  - transactions convert from their OWN per-row currency, not blanket-
 *    converted as if denominated in the valuation currency.
 * Runs against real SQLite through the real migrations.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { computePortfolioView } from './netWorth';

const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');
const TODAY = '2025-07-17';

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

const NOW = `${TODAY}T12:00:00.000Z`;
let nextId = 0;
const id = () => `test-${++nextId}`;

async function addMarkAsset(
  db: Db,
  currency: string,
  valueMinor: number,
  name = `${currency} thing`
): Promise<string> {
  const assetId = id();
  await db.insert(schema.assets).values({
    id: assetId,
    class: 'COLLECTIBLE',
    name,
    platform: 'Home safe',
    currency,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(schema.valuationMarks).values({
    id: id(),
    assetId,
    date: TODAY,
    valueMinor,
    currency,
    source: 'manual',
    createdAt: NOW,
  });
  return assetId;
}

async function addTxn(
  db: Db,
  assetId: string,
  type: (typeof schema.TRANSACTION_TYPES)[number],
  date: string,
  amountMinor: number,
  currency: string
): Promise<void> {
  await db.insert(schema.transactions).values({
    id: id(),
    assetId,
    type,
    date,
    amountMinor,
    currency,
    fingerprint: id(),
    createdAt: NOW,
  });
}

describe('computePortfolioView — FX degradation (spec §8)', () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb(); // base currency defaults to AED; fx_rates starts empty
  });

  it('empty fx series degrades the asset to unvalued instead of throwing', async () => {
    // JPY→AED was never fetched: getRateSeries returns an EMPTY series.
    const jpyId = await addMarkAsset(db, 'JPY', 4_500_000, 'JPY box');
    const aedId = await addMarkAsset(db, 'AED', 100_000, 'AED rug');

    const view = await computePortfolioView(db, TODAY);

    // The AED asset still aggregates; the JPY one is surfaced as unvalued.
    expect(view.netWorth.totalMinor).toBe(100_000);
    expect(view.netWorth.unvalued).toEqual([{ id: jpyId, name: 'JPY box' }]);
    expect(view.netWorth.perAsset.map((a) => a.id)).toEqual([aedId]);
    // Native valuation is still shown per-asset; base breakdown is not.
    const jpy = view.assets.find((a) => a.id === jpyId)!;
    expect(jpy.valuation?.amountMinor).toBe(4_500_000);
    expect(jpy.breakdown).toBeNull();
  });

  it('USD→AED falls back to the hardcoded peg when no rate was ever cached', async () => {
    await addMarkAsset(db, 'USD', 10_000, 'USD note'); // $100
    const view = await computePortfolioView(db, TODAY);
    // $100 × 3.6725 = AED 367.25 — never unvalued, never a parity 1.0.
    expect(view.netWorth.totalMinor).toBe(36_725);
    expect(view.netWorth.unvalued).toEqual([]);
  });

  it('converts each transaction from its own currency, not the valuation currency', async () => {
    await db.insert(schema.fxRates).values({
      id: id(),
      base: 'USD',
      quote: 'AED',
      rate: 3.6725,
      asOf: '2025-01-15',
    });
    // USD-denominated asset bought with an AED-denominated flow (what
    // actually left the bank): AED 36,725 ≙ $10,000.
    const assetId = await addMarkAsset(db, 'USD', 1_000_000, 'USD equity');
    await addTxn(db, assetId, 'BUY', '2025-01-15', -3_672_500, 'AED');

    const view = await computePortfolioView(db, TODAY);
    const breakdown = view.assets.find((a) => a.id === assetId)!.breakdown!;

    // Cost basis in base must be AED 36,725 — NOT AED 36,725 × 3.6725.
    expect(breakdown.costBasisMinor).toBe(3_672_500);
    expect(breakdown.grossGainMinor).toBe(0); // value $10,000 = AED 36,725
  });

  it('mixed-currency txns with a missing pair yield a null breakdown, not a crash', async () => {
    // USD→AED resolves via the peg, but the EUR flow has no series at all.
    const assetId = await addMarkAsset(db, 'USD', 1_000_000, 'USD equity');
    await addTxn(db, assetId, 'BUY', '2025-01-15', -900_000, 'EUR');

    const view = await computePortfolioView(db, TODAY);
    const asset = view.assets.find((a) => a.id === assetId)!;

    expect(asset.breakdown).toBeNull(); // flagged, never mis-converted
    expect(view.netWorth.totalMinor).toBe(3_672_500); // valuation still aggregates
  });
});
