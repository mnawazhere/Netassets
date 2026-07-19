import { describe, expect, it } from '@jest/globals';

import { navHistory, type HistoryAsset } from './navHistory';

/** Tier 2 NAV-over-time chart. Valuation policy (v1, labeled in the UI):
 *  mark-valued assets step through their dated marks; market assets are
 *  historical quantity × TODAY's price (we store no price history yet).
 *  Liabilities subtract at their current outstanding. */

const reeman: HistoryAsset = {
  id: 'reeman',
  kind: 'marks',
  marks: [
    { date: '2024-06-01', valueMinor: 145000000 },
    { date: '2025-06-15', valueMinor: 160000000 },
  ],
  toBase: (m) => m,
};

const aapl: HistoryAsset = {
  id: 'aapl',
  kind: 'market',
  quantityChanges: [
    { date: '2025-01-15', delta: 10 },
    { date: '2025-03-10', delta: 5 },
    { date: '2025-08-01', delta: -5 },
  ],
  currentPriceMinor: 21240, // per unit, native
  toBase: (m) => Math.round(m * 3.6725),
};

describe('navHistory', () => {
  const points = navHistory([reeman, aapl], [], '2024-05-01', '2025-09-30');

  it('emits month-end points from range start to range end', () => {
    expect(points[0].date).toBe('2024-05-31');
    expect(points[points.length - 1].date).toBe('2025-09-30');
    expect(points.length).toBe(17);
  });

  it('mark assets step: zero before first mark, latest mark after', () => {
    const may24 = points.find((p) => p.date === '2024-05-31')!;
    expect(may24.totalMinor).toBe(0); // before any mark, no position
    const jun24 = points.find((p) => p.date === '2024-06-30')!;
    expect(jun24.totalMinor).toBe(145000000);
    const jul25 = points.find((p) => p.date === '2025-07-31')!;
    // 160M mark + 15 shares × 21240 × fx
    expect(jul25.totalMinor).toBe(160000000 + Math.round(15 * 21240 * 3.6725));
  });

  it('market assets track quantity through buys and sells at today price', () => {
    const feb25 = points.find((p) => p.date === '2025-02-28')!;
    expect(feb25.totalMinor).toBe(145000000 + Math.round(10 * 21240 * 3.6725));
    const sep25 = points.find((p) => p.date === '2025-09-30')!;
    expect(sep25.totalMinor).toBe(160000000 + Math.round(10 * 21240 * 3.6725));
  });

  it('subtracts liabilities at current outstanding from every point', () => {
    const withDebt = navHistory([reeman], [{ outstandingBaseMinor: 85000000 }], '2025-06-01', '2025-07-31');
    const jun = withDebt.find((p) => p.date === '2025-06-30')!;
    expect(jun.totalMinor).toBe(160000000 - 85000000);
  });

  it('a dated debt only subtracts from its fromDate onward', () => {
    const pts = navHistory(
      [reeman],
      [{ outstandingBaseMinor: 85000000, fromDate: '2024-06-01' }],
      '2024-04-01',
      '2024-07-31'
    );
    // Before the financed asset exists: no asset value, no debt — zero.
    expect(pts.find((p) => p.date === '2024-04-30')!.totalMinor).toBe(0);
    // From the purchase month: mark − debt.
    expect(pts.find((p) => p.date === '2024-06-30')!.totalMinor).toBe(145000000 - 85000000);
  });

  it('handles an empty portfolio', () => {
    expect(navHistory([], [], '2025-01-01', '2025-03-31').every((p) => p.totalMinor === 0)).toBe(true);
  });
});
