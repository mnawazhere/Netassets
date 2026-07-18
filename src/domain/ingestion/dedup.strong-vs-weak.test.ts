import { describe, expect, it } from '@jest/globals';

import { planRow } from './dedup';
import type { ExistingTxn, ParsedTransaction } from './types';

/** Asymmetric dedup: incoming row carries a broker id (strong key) but the
 *  SAME trade was previously stored id-less (voice/screenshot capture, weak
 *  fingerprint). The strong fingerprint never collides, so content checks
 *  must still run against weak-keyed existing rows — otherwise re-importing
 *  the real CSV for an already-captured period doubles every transaction. */

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

describe('planRow: strong incoming vs weak-keyed existing', () => {
  const weakExisting = existingFromRow(makeRow({ sourceTxnId: null }), 'txn-weak');

  it('same content inside a covered window → skip-exact (presumed re-import)', () => {
    const plan = planRow(makeRow(), {
      existing: [weakExisting],
      coveredRanges: [{ sourceAccount: 'etoro', periodStart: '2025-01-01', periodEnd: '2025-06-30' }],
    });
    expect(plan).toMatchObject({ action: 'skip-exact', reason: 'covered-weak-match' });
  });

  it('same content outside coverage → review, never a silent double-insert', () => {
    const plan = planRow(makeRow(), { existing: [weakExisting], coveredRanges: [] });
    expect(plan).toMatchObject({
      action: 'review',
      reason: 'weak-collision',
      conflictsWith: 'txn-weak',
    });
  });

  it('rounding diff against a weak-keyed row → review near-match', () => {
    const plan = planRow(makeRow({ amountMinor: -185301 }), {
      existing: [weakExisting],
      coveredRanges: [],
    });
    expect(plan).toMatchObject({ action: 'review', reason: 'near-match', conflictsWith: 'txn-weak' });
  });

  it('identical content on a STRONG-keyed existing row (distinct id) still inserts', () => {
    const strongExisting = existingFromRow(makeRow({ sourceTxnId: 'POS-0999' }), 'txn-strong');
    const plan = planRow(makeRow(), { existing: [strongExisting], coveredRanges: [] });
    expect(plan.action).toBe('insert');
  });
});
