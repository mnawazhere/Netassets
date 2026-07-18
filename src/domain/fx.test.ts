import { describe, expect, it } from '@jest/globals';

import { convertAtDates, makeRateSeries, rateOn } from './fx';

const usdAed = makeRateSeries([
  { date: '2024-01-15', rate: 3.6725 },
  { date: '2024-06-01', rate: 3.6731 },
  { date: '2025-01-02', rate: 3.672 },
]);

describe('rateOn — dated lookup, carry-forward', () => {
  it('exact date hit', () => {
    expect(rateOn(usdAed, '2024-06-01')).toBe(3.6731);
  });

  it('carries the latest earlier rate forward (weekends, gaps)', () => {
    expect(rateOn(usdAed, '2024-06-15')).toBe(3.6731);
    expect(rateOn(usdAed, '2024-05-31')).toBe(3.6725);
  });

  it('date after the last point uses the last point', () => {
    expect(rateOn(usdAed, '2026-01-01')).toBe(3.672);
  });

  it('date before the first point falls back to the earliest (flagged, not thrown)', () => {
    expect(rateOn(usdAed, '2020-01-01')).toBe(3.6725);
  });

  it('accepts unsorted input', () => {
    const series = makeRateSeries([
      { date: '2025-01-02', rate: 3.0 },
      { date: '2024-01-15', rate: 1.0 },
      { date: '2024-06-01', rate: 2.0 },
    ]);
    expect(rateOn(series, '2024-07-01')).toBe(2.0);
  });

  it('empty series throws — a silent 1.0 would corrupt every amount', () => {
    expect(() => rateOn(makeRateSeries([]), '2024-01-01')).toThrow(/empty/i);
  });
});

describe('convertAtDates — each flow at ITS OWN date (spec §8 v4)', () => {
  it('converts per-date, not at one spot rate', () => {
    const jpyAed = makeRateSeries([
      { date: '2023-09-22', rate: 0.03 },
      { date: '2025-06-01', rate: 0.0239 },
    ]);
    const flows = convertAtDates(
      [
        { type: 'BUY', date: '2023-09-22', amountMinor: -5800, hoursSpent: 5 },
        { type: 'SELL', date: '2025-06-01', amountMinor: 5800, hoursSpent: 0 },
      ],
      'JPY',
      'AED',
      jpyAed
    );
    // ¥5,800 @0.030 → AED 174.00; @0.0239 → AED 138.62
    expect(flows[0].amountMinor).toBe(-17400);
    expect(flows[1].amountMinor).toBe(13862);
    // hours and types pass through untouched
    expect(flows[0].hoursSpent).toBe(5);
    expect(flows[1].type).toBe('SELL');
  });

  it('rounds each converted flow at the target scale (JPY→AED lands on fils)', () => {
    const series = makeRateSeries([{ date: '2024-01-01', rate: 0.0239 }]);
    const [f] = convertAtDates(
      [{ type: 'BUY', date: '2024-01-01', amountMinor: -333, hoursSpent: 0 }],
      'JPY',
      'AED',
      series
    );
    expect(f.amountMinor).toBe(-796); // 333 × 0.0239 = 7.9587 AED → 795.87 → 796 fils
  });
});
