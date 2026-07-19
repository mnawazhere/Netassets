/**
 * First-launch demo portfolio — exercises every table so each later stage
 * has real rows to work against: a multi-lot US equity (USD, imported), a
 * rental property (AED, manual/voice), and a sealed collectible (JPY —
 * 0-decimal currency on purpose).
 *
 * Conventions (spec §6 v3):
 * - No stored lots — cost basis derives from BUY/SELL transactions.
 * - BUY/SELL amount = quantity × unit price ONLY; fees are separate FEE
 *   rows (so fees never double-count between cost basis and money costs).
 * - Imported rows carry the broker's transaction ID (source_txn_id).
 */
import { sql } from 'drizzle-orm';

import { fxRates, imports, priceCache, settings } from '@/db/schema';
import type { Db } from '@/db/client';
import { toMinor } from '@/domain/money';
import { nowISO, uuid } from '@/lib/uuid';
import { createAsset, listAssets } from '@/repositories/assets';
import { createLiability } from '@/repositories/liabilities';
import { SETTING_KEYS, setSetting } from '@/repositories/settings';
import { insertTransaction, insertValuationMark } from '@/repositories/transactions';

/** Settings key claimed atomically (settings_key_uq) by the run that seeds.
 *  Committed in the SAME transaction as the demo rows, so it also means the
 *  portfolio is complete — and a user who deletes every demo asset is never
 *  re-seeded on the next launch. */
const SEED_CLAIM_KEY = 'demo_seeded';

/** One in-flight seed per db handle: a StrictMode double-invoke or provider
 *  remount while the first (async) run is still mid-flight must join it, not
 *  race it — two interleaved runs would each see an empty assets table. */
const inFlight = new WeakMap<Db, Promise<void>>();

export function seedIfEmpty(db: Db): Promise<void> {
  const running = inFlight.get(db);
  if (running) return running;
  const run = seedOnce(db).finally(() => {
    inFlight.delete(db);
  });
  inFlight.set(db, run);
  return run;
}

async function seedOnce(db: Db): Promise<void> {
  const existing = await listAssets(db);
  if (existing.length > 0) return;

  const now = nowISO();
  // fx_rates is a DATE-keyed series (fx service convention: date-only asOf,
  // deduped by fx_rates_pair_asof_uq). Seeding a full datetime here would let
  // the post-seed live refresh add a SECOND point for the same day.
  const today = now.slice(0, 10);

  // The expo-sqlite drizzle driver's transaction() callback is synchronous,
  // so it cannot span the async repository helpers below — open the
  // transaction manually instead. Either the whole demo portfolio commits
  // (claim row included) or none of it does; a mid-seed crash can never
  // strand a half-built portfolio that the guard above would skip forever.
  await db.run(sql`begin`);
  try {
    // Atomic claim: if a previous launch already seeded, the insert is a
    // no-op (settings_key_uq) and we bail without touching anything.
    const claim = await db
      .insert(settings)
      .values({ id: uuid(), key: SEED_CLAIM_KEY, value: now, updatedAt: now })
      .onConflictDoNothing();
    if (claim.changes === 0) {
      await db.run(sql`rollback`);
      return;
    }

    // --- Settings: AED base, AED 300/hr baseline (spec §5 worked example) ---
    await setSetting(db, SETTING_KEYS.baseCurrency, 'AED', 'system');
    await setSetting(db, SETTING_KEYS.hourlyRateCurrency, 'AED', 'system');
    await setSetting(db, SETTING_KEYS.hourlyRateMinor, String(toMinor('300', 'AED')), 'system');

    // --- Cached FX (Stage 4 replaces with a live provider) ---
    await db.insert(fxRates).values([
      { id: uuid(), base: 'USD', quote: 'AED', rate: 3.6725, asOf: today },
      { id: uuid(), base: 'JPY', quote: 'AED', rate: 0.0239, asOf: today },
    ]);

  // --- 1. Equity: AAPL on eToro (USD), two buys, one dividend, imported ---
  const importId = uuid();
  await db.insert(imports).values({
    id: importId,
    fileName: 'etoro-statement-2025-H1.pdf',
    kind: 'pdf',
    platform: 'eToro',
    periodStart: '2025-01-01',
    periodEnd: '2025-06-30',
    status: 'processed',
    importedAt: now,
  });

  const aapl = await createAsset(db, {
    class: 'EQUITY',
    name: 'Apple Inc.',
    platform: 'eToro',
    currency: 'USD',
    symbol: 'AAPL',
    providerId: 'aapl.us',
  });
  const etoro = { sourceAccount: 'etoro', sourceRef: importId };
  await insertTransaction(
    db,
    {
      assetId: aapl,
      type: 'BUY',
      date: '2025-01-15',
      amountMinor: -toMinor('1853.00', 'USD'), // 10 × 185.30
      currency: 'USD',
      quantity: 10,
      hoursSpent: 0.1,
      sourceTxnId: 'ETORO-1001001',
      ...etoro,
    },
    'import'
  );
  await insertTransaction(
    db,
    {
      assetId: aapl,
      type: 'FEE',
      date: '2025-01-15',
      amountMinor: -toMinor('1.50', 'USD'),
      currency: 'USD',
      quantity: null,
      hoursSpent: 0,
      sourceTxnId: 'ETORO-1001001-FEE',
      ...etoro,
    },
    'import'
  );
  await insertTransaction(
    db,
    {
      assetId: aapl,
      type: 'BUY',
      date: '2025-04-02',
      amountMinor: -toMinor('1005.50', 'USD'), // 5 × 201.10
      currency: 'USD',
      quantity: 5,
      hoursSpent: 0.1,
      sourceTxnId: 'ETORO-1002002',
      ...etoro,
    },
    'import'
  );
  await insertTransaction(
    db,
    {
      assetId: aapl,
      type: 'FEE',
      date: '2025-04-02',
      amountMinor: -toMinor('1.50', 'USD'),
      currency: 'USD',
      quantity: null,
      hoursSpent: 0,
      sourceTxnId: 'ETORO-1002002-FEE',
      ...etoro,
    },
    'import'
  );
  // Same security on a second broker — the location view must show this
  // as its own line (spec §3.1 v6), derived from source_account.
  await insertTransaction(
    db,
    {
      assetId: aapl,
      type: 'BUY',
      date: '2025-06-10',
      amountMinor: -toMinor('1050.00', 'USD'), // 5 × 210.00
      currency: 'USD',
      quantity: 5,
      hoursSpent: 0.1,
      sourceAccount: 'trading212',
      sourceTxnId: 'T212-555001',
      sourceRef: null,
    },
    'import'
  );
  await insertTransaction(
    db,
    {
      assetId: aapl,
      type: 'DIVIDEND',
      date: '2025-05-15',
      amountMinor: toMinor('3.75', 'USD'),
      currency: 'USD',
      quantity: null,
      hoursSpent: 0,
      sourceTxnId: 'ETORO-1003003',
      ...etoro,
    },
    'import'
  );
  await db.insert(priceCache).values({
    id: uuid(),
    symbol: 'AAPL',
    currency: 'USD',
    priceMinor: toMinor('212.40', 'USD'),
    asOf: now,
    fetchedAt: now,
  });

  // --- 2. Property: Reeman unit (AED), rent in, maintenance out, marked value ---
  const reeman = await createAsset(db, {
    class: 'PROPERTY',
    name: 'Reeman unit',
    platform: 'Al Reeman',
    currency: 'AED',
  });
  const manual = { sourceAccount: null, sourceTxnId: null, sourceRef: null };
  await insertTransaction(
    db,
    {
      assetId: reeman,
      type: 'BUY',
      date: '2024-06-01',
      amountMinor: -toMinor('1450000', 'AED'),
      currency: 'AED',
      quantity: 1,
      hoursSpent: 40,
      ...manual,
    },
    'manual'
  );
  await insertTransaction(
    db,
    {
      assetId: reeman,
      type: 'FEE',
      date: '2024-06-01',
      amountMinor: -toMinor('29000', 'AED'), // 2% transfer fee
      currency: 'AED',
      quantity: null,
      hoursSpent: 0,
      note: 'Transfer fee',
      ...manual,
    },
    'manual'
  );
  for (const month of ['2025-04-01', '2025-05-01', '2025-06-01']) {
    await insertTransaction(
      db,
      {
        assetId: reeman,
        type: 'RENT',
        date: month,
        amountMinor: toMinor('7000', 'AED'),
        currency: 'AED',
        quantity: null,
        hoursSpent: 10, // default property maintenance time (spec §4)
        ...manual,
      },
      'voice'
    );
  }
  await insertTransaction(
    db,
    {
      assetId: reeman,
      type: 'MAINTENANCE',
      date: '2025-05-20',
      amountMinor: -toMinor('3200', 'AED'),
      currency: 'AED',
      quantity: null,
      hoursSpent: 4,
      ...manual,
    },
    'manual'
  );
  await insertValuationMark(db, {
    assetId: reeman,
    date: '2024-06-01',
    valueMinor: toMinor('1450000', 'AED'),
    currency: 'AED',
    source: 'manual',
    note: 'Purchase price',
  });
  await insertValuationMark(db, {
    assetId: reeman,
    date: '2025-06-15',
    valueMinor: toMinor('1600000', 'AED'),
    currency: 'AED',
    source: 'voice',
    note: '"Reeman unit\'s worth ~1.6M now"',
  });
  // NAV = assets − liabilities: the outstanding finance on the unit. The
  // balance is a PLACEHOLDER — the owner edits it in Settings; without this
  // row the headline number silently overstates real wealth (PM tier 1).
  await createLiability(db, {
    name: 'ADIB Ijarah — Reeman unit',
    kind: 'PROPERTY_FINANCE',
    assetId: reeman,
    currency: 'AED',
    outstandingMinor: toMinor('850000', 'AED'),
    asOf: '2025-06-01',
    note: 'Placeholder balance — set the actual outstanding in Settings',
  });

  // --- 3. Collectible: sealed Pokémon box (JPY — 0-decimal currency) ---
  const pokemon = await createAsset(db, {
    class: 'COLLECTIBLE',
    name: 'Pokémon 151 sealed booster box',
    platform: 'Home safe',
    currency: 'JPY',
  });
  await insertTransaction(
    db,
    {
      assetId: pokemon,
      type: 'BUY',
      date: '2023-09-22',
      amountMinor: -toMinor('5800', 'JPY'),
      currency: 'JPY',
      quantity: 1,
      hoursSpent: 5, // 4 hrs in line + 1 hr travel (spec §4)
      ...manual,
    },
    'manual'
  );
  await insertValuationMark(db, {
    assetId: pokemon,
    date: '2025-06-01',
    valueMinor: toMinor('45000', 'JPY'),
    currency: 'JPY',
    source: 'manual',
    note: 'Sealed, market ask',
  });

    await db.run(sql`commit`);
  } catch (e) {
    await db.run(sql`rollback`);
    throw e;
  }
}
