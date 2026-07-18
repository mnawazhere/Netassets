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
import { fxRates, imports, priceCache } from '@/db/schema';
import type { Db } from '@/db/client';
import { toMinor } from '@/domain/money';
import { nowISO, uuid } from '@/lib/uuid';
import { createAsset, listAssets } from '@/repositories/assets';
import { SETTING_KEYS, setSetting } from '@/repositories/settings';
import { insertTransaction, insertValuationMark } from '@/repositories/transactions';

export async function seedIfEmpty(db: Db): Promise<void> {
  const existing = await listAssets(db);
  if (existing.length > 0) return;

  const now = nowISO();

  // --- Settings: AED base, AED 300/hr baseline (spec §5 worked example) ---
  await setSetting(db, SETTING_KEYS.baseCurrency, 'AED', 'system');
  await setSetting(db, SETTING_KEYS.hourlyRateCurrency, 'AED', 'system');
  await setSetting(db, SETTING_KEYS.hourlyRateMinor, String(toMinor('300', 'AED')), 'system');

  // --- Cached FX (Stage 4 replaces with a live provider) ---
  await db.insert(fxRates).values([
    { id: uuid(), base: 'USD', quote: 'AED', rate: 3.6725, asOf: now },
    { id: uuid(), base: 'JPY', quote: 'AED', rate: 0.0239, asOf: now },
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
}
