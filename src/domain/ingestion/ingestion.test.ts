import { describe, expect, it } from '@jest/globals';

import { analyzeCoverage } from './coverage';
import { planRow } from './dedup';
import { parseEtoroCsv } from './etoro';
import { resolveAsset, type ExistingAsset } from './resolution';
import type { ExistingTxn, ParsedTransaction } from './types';

// ---------- resolution: STEP ONE, before fingerprinting ----------

const existingAssets: ExistingAsset[] = [
  { id: 'aapl-1', class: 'EQUITY', name: 'Apple Inc.', symbol: 'AAPL', platform: 'eToro' },
  { id: 'reeman-1', class: 'PROPERTY', name: 'Reeman unit', symbol: null, platform: 'Al Reeman' },
];

describe('resolveAsset', () => {
  it('re-imported eToro row lands on the existing AAPL asset', () => {
    const r = resolveAsset(existingAssets, {
      symbol: 'aapl',
      name: 'Apple',
      class: 'EQUITY',
      platform: 'eToro',
      currency: 'USD',
    });
    expect(r).toEqual({ kind: 'existing', assetId: 'aapl-1' });
  });

  it('same ticker from ANOTHER account still resolves to the one asset (spec §3.1)', () => {
    const r = resolveAsset(existingAssets, {
      symbol: 'AAPL',
      class: 'EQUITY',
      platform: 'IBKR',
      currency: 'USD',
    });
    expect(r).toEqual({ kind: 'existing', assetId: 'aapl-1' });
  });

  it('unknown symbol → create', () => {
    const r = resolveAsset(existingAssets, {
      symbol: 'MSFT',
      class: 'EQUITY',
      platform: 'eToro',
      currency: 'USD',
    });
    expect(r.kind).toBe('create');
  });

  it('property resolves by normalized name', () => {
    const r = resolveAsset(existingAssets, {
      name: '  reeman UNIT ',
      class: 'PROPERTY',
      currency: 'AED',
    });
    expect(r).toEqual({ kind: 'existing', assetId: 'reeman-1' });
  });

  it('market row without a symbol is a hard error — resolution is not optional', () => {
    expect(() => resolveAsset([], { class: 'EQUITY', currency: 'USD' })).toThrow(/symbol/);
  });
});

// ---------- dedup planning ----------

function makeRow(over: Partial<ParsedTransaction & { assetId: string }> = {}) {
  return {
    assetId: 'aapl-1',
    asset: { symbol: 'AAPL', class: 'EQUITY' as const, currency: 'USD' },
    type: 'BUY' as const,
    date: '2025-01-15',
    amountMinor: -185300,
    currency: 'USD',
    quantity: 10,
    hoursSpent: 0.1,
    sourceAccount: 'etoro',
    sourceTxnId: 'POS-1001' as string | null,
    ...over,
  };
}

function existingFromRow(row: ReturnType<typeof makeRow>, id = 'txn-1'): ExistingTxn {
  const plan = planRow(row, { existing: [], coveredRanges: [] });
  return {
    id,
    assetId: row.assetId,
    fingerprint: plan.fingerprint,
    type: row.type,
    date: row.date,
    amountMinor: row.amountMinor,
    quantity: row.quantity ?? null,
    sourceAccount: row.sourceAccount ?? null,
  };
}

describe('planRow', () => {
  it('fresh row → insert', () => {
    expect(planRow(makeRow(), { existing: [], coveredRanges: [] }).action).toBe('insert');
  });

  it('strong-key re-import → skip-exact, silently', () => {
    const row = makeRow();
    const plan = planRow(row, { existing: [existingFromRow(row)], coveredRanges: [] });
    expect(plan).toMatchObject({ action: 'skip-exact', reason: 'strong-key-match' });
  });

  it('strong keys: identical same-day fills with different broker ids BOTH insert', () => {
    const fill1 = makeRow({ sourceTxnId: 'POS-1001' });
    const fill2 = makeRow({ sourceTxnId: 'POS-1002' });
    const plan = planRow(fill2, { existing: [existingFromRow(fill1)], coveredRanges: [] });
    expect(plan.action).toBe('insert');
  });

  it('weak-key collision inside a covered statement window → skip (presumed re-import)', () => {
    const row = makeRow({ sourceTxnId: null });
    const plan = planRow(row, {
      existing: [existingFromRow(row)],
      coveredRanges: [{ sourceAccount: 'etoro', periodStart: '2025-01-01', periodEnd: '2025-06-30' }],
    });
    expect(plan).toMatchObject({ action: 'skip-exact', reason: 'covered-weak-match' });
  });

  it('weak-key collision OUTSIDE coverage → review, never dropped, never inserted', () => {
    const row = makeRow({ sourceTxnId: null });
    const plan = planRow(row, { existing: [existingFromRow(row, 'txn-9')], coveredRanges: [] });
    expect(plan).toMatchObject({
      action: 'review',
      reason: 'weak-collision',
      conflictsWith: 'txn-9',
    });
  });

  it('rounding diff on a re-export → review near-match', () => {
    const original = makeRow({ sourceTxnId: null });
    const rounded = makeRow({ sourceTxnId: null, amountMinor: -185301 });
    const plan = planRow(rounded, { existing: [existingFromRow(original)], coveredRanges: [] });
    expect(plan).toMatchObject({ action: 'review', reason: 'near-match' });
  });

  it('genuinely different amount is NOT a near-match', () => {
    const original = makeRow({ sourceTxnId: null });
    const different = makeRow({ sourceTxnId: null, amountMinor: -200000 });
    const plan = planRow(different, { existing: [existingFromRow(original)], coveredRanges: [] });
    expect(plan.action).toBe('insert');
  });
});

// ---------- statement coverage ----------

describe('analyzeCoverage', () => {
  const h1 = { sourceAccount: 'etoro', periodStart: '2025-01-01', periodEnd: '2025-06-30' };

  it('flags overlap with an existing window on the same account', () => {
    const r = analyzeCoverage([h1], {
      sourceAccount: 'etoro',
      periodStart: '2025-06-01',
      periodEnd: '2025-09-30',
    });
    expect(r.overlaps).toEqual([h1]);
    expect(r.gapBefore).toBeNull();
  });

  it('flags a gap between statements', () => {
    const r = analyzeCoverage([h1], {
      sourceAccount: 'etoro',
      periodStart: '2025-09-01',
      periodEnd: '2025-12-31',
    });
    expect(r.overlaps).toEqual([]);
    expect(r.gapBefore).toEqual({ from: '2025-07-01', to: '2025-08-31' });
  });

  it('different account is a different coverage universe', () => {
    const r = analyzeCoverage([h1], {
      sourceAccount: 'ibkr',
      periodStart: '2025-06-01',
      periodEnd: '2025-09-30',
    });
    expect(r.overlaps).toEqual([]);
  });
});

// ---------- eToro CSV ----------

const ETORO_CSV = [
  'Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA',
  '02/01/2025 10:00:00,Deposit,,5000.00,-,-,-,5000.00,,,0.00',
  '15/01/2025 14:32:11,Open Position,AAPL/USD,1853.00,10,0.00,0.00,3147.00,3111001,Stocks,0.00',
  '15/01/2025 14:32:11,Fee,AAPL/USD,1.50,-,-1.50,0.00,3145.50,3111001,Stocks,0.00',
  '15/05/2025 09:00:00,Dividend,AAPL/USD,3.75,-,3.75,3.75,3149.25,3111001,Stocks,0.00',
  '20/05/2025 11:00:00,Something Unknown,???,1.00,-,-,-,0.00,,,0.00',
].join('\n');

describe('parseEtoroCsv', () => {
  const r = parseEtoroCsv(ETORO_CSV);

  it('maps rows to typed transactions with signs derived from Type', () => {
    expect(r.transactions).toHaveLength(3);
    const [buy, fee, div] = r.transactions;
    expect(buy).toMatchObject({
      type: 'BUY',
      date: '2025-01-15',
      amountMinor: -185300,
      quantity: 10,
      sourceTxnId: '3111001:open position',
    });
    expect(buy.asset).toMatchObject({ symbol: 'AAPL', class: 'EQUITY', platform: 'eToro' });
    expect(fee).toMatchObject({ type: 'FEE', amountMinor: -150, quantity: null });
    expect(div).toMatchObject({ type: 'DIVIDEND', date: '2025-05-15', amountMinor: 375 });
  });

  it('skips cash movements, surfaces unknown rows', () => {
    expect(r.skipped).toBe(1); // the deposit
    expect(r.unparsed).toHaveLength(1); // "Something Unknown"
  });

  it('reports the statement window for coverage tracking', () => {
    expect(r.periodStart).toBe('2025-01-15');
    expect(r.periodEnd).toBe('2025-05-15');
  });

  it('same file parsed twice yields identical rows (determinism for dedup)', () => {
    expect(parseEtoroCsv(ETORO_CSV)).toEqual(r);
  });
});
