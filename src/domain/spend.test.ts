import { describe, expect, it } from '@jest/globals';

import { aggregateSpend, type SpendEntry } from './spend';

/** §14 projected vs actual: recorded monthly spend, summed per month
 *  (several cards → several rows), YTD total, and the projected-vs-actual
 *  variance the cashflow card shows. */
const entries: SpendEntry[] = [
  { month: '2026-01', amountMinor: 1750000, currency: 'AED' },
  { month: '2026-01', amountMinor: 250000, currency: 'AED' }, // second card
  { month: '2026-02', amountMinor: 1900000, currency: 'AED' },
  { month: '2025-12', amountMinor: 9999999, currency: 'AED' }, // other year
  { month: '2026-03', amountMinor: 40000, currency: 'USD' }, // needs FX
];

const toBase = (m: number, c: string): number | null =>
  c === 'AED' ? m : c === 'USD' ? Math.round(m * 3.6725) : null;

describe('aggregateSpend', () => {
  const v = aggregateSpend(entries, 2026, toBase);

  it('sums rows within a month and ignores other years', () => {
    expect(v.byMonth[0]).toBe(2000000); // Jan: both cards
    expect(v.byMonth[1]).toBe(1900000);
    expect(v.byMonth[11]).toBe(0); // Dec 2026 has nothing; 2025-12 excluded
  });

  it('converts foreign-currency rows at spot', () => {
    expect(v.byMonth[2]).toBe(Math.round(40000 * 3.6725));
  });

  it('totals YTD and counts recorded months', () => {
    expect(v.ytdMinor).toBe(2000000 + 1900000 + Math.round(40000 * 3.6725));
    expect(v.monthsRecorded).toBe(3);
  });

  it('surfaces unconvertible rows instead of dropping them', () => {
    const withChf = [...entries, { month: '2026-04', amountMinor: 100, currency: 'CHF' }];
    const v2 = aggregateSpend(withChf, 2026, toBase);
    expect(v2.unconverted).toEqual([{ month: '2026-04' }]);
    expect(v2.ytdMinor).toBe(v.ytdMinor);
  });

  it('average recorded month drives the annualized actual estimate', () => {
    expect(v.avgMonthMinor).toBe(Math.round(v.ytdMinor / 3));
  });
});
