import { describe, expect, it } from '@jest/globals';

import { aggregateIncome, type IncomeTxn } from './income';

/** Tier 2 income view: every recorded DIVIDEND and RENT surfaced as
 *  "AED X earned this year" — the foundation the salary runner needs. */

const txns: IncomeTxn[] = [
  // Reeman rent, three months of 2025
  { assetId: 'reeman', assetName: 'Reeman unit', type: 'RENT', date: '2025-04-01', amountMinor: 700000, currency: 'AED' },
  { assetId: 'reeman', assetName: 'Reeman unit', type: 'RENT', date: '2025-05-01', amountMinor: 700000, currency: 'AED' },
  { assetId: 'reeman', assetName: 'Reeman unit', type: 'RENT', date: '2025-06-01', amountMinor: 700000, currency: 'AED' },
  // AAPL dividend (USD)
  { assetId: 'aapl', assetName: 'Apple Inc.', type: 'DIVIDEND', date: '2025-05-10', amountMinor: 2500, currency: 'USD' },
  // Prior-year rent must not leak into 2025
  { assetId: 'reeman', assetName: 'Reeman unit', type: 'RENT', date: '2024-12-01', amountMinor: 700000, currency: 'AED' },
  // A BUY is not income
  { assetId: 'aapl', assetName: 'Apple Inc.', type: 'BUY', date: '2025-01-15', amountMinor: -185300, currency: 'USD' },
  // Negative RENT (a clawback/refund) still counts — income is signed
  { assetId: 'reeman', assetName: 'Reeman unit', type: 'RENT', date: '2025-06-20', amountMinor: -50000, currency: 'AED' },
];

const toBase = (amountMinor: number, currency: string): number | null => {
  if (currency === 'AED') return amountMinor;
  if (currency === 'USD') return Math.round(amountMinor * 3.6725);
  return null; // unconvertible
};

describe('aggregateIncome', () => {
  const view = aggregateIncome(txns, 2025, toBase);

  it('totals only DIVIDEND and RENT rows inside the year, signed', () => {
    const rentAed = 700000 * 3 - 50000;
    const divAed = Math.round(2500 * 3.6725);
    expect(view.totalMinor).toBe(rentAed + divAed);
  });

  it('splits by type', () => {
    expect(view.byType.RENT).toBe(700000 * 3 - 50000);
    expect(view.byType.DIVIDEND).toBe(Math.round(2500 * 3.6725));
  });

  it('splits by asset, sorted descending', () => {
    expect(view.byAsset[0]).toEqual({
      assetId: 'reeman',
      assetName: 'Reeman unit',
      amountMinor: 700000 * 3 - 50000,
    });
    expect(view.byAsset[1].assetId).toBe('aapl');
  });

  it('splits by month for the chart (1-12 keyed, missing months zero)', () => {
    expect(view.byMonth[3]).toBe(700000); // April
    expect(view.byMonth[0]).toBe(0); // January
    expect(view.byMonth[5]).toBe(700000 - 50000); // June: rent + clawback
  });

  it('surfaces unconvertible income rows instead of dropping them silently', () => {
    const withChf: IncomeTxn[] = [
      ...txns,
      { assetId: 'x', assetName: 'CHF thing', type: 'DIVIDEND', date: '2025-03-01', amountMinor: 1000, currency: 'CHF' },
    ];
    const v = aggregateIncome(withChf, 2025, toBase);
    expect(v.unconverted).toEqual([{ assetId: 'x', assetName: 'CHF thing', date: '2025-03-01' }]);
    expect(v.totalMinor).toBe(view.totalMinor); // not guessed into the total
  });

  it('returns an all-zero view for a year with no income', () => {
    const v = aggregateIncome(txns, 2023, toBase);
    expect(v.totalMinor).toBe(0);
    expect(v.byAsset).toEqual([]);
    expect(v.byMonth).toEqual(Array(12).fill(0));
  });
});
