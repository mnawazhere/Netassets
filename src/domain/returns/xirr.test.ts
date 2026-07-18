import { describe, expect, it } from '@jest/globals';

import { normalizeUTC } from '../dates';
import { xirr, type DatedFlow } from './xirr';

function flow(date: string, amountMinor: number): DatedFlow {
  return { date: normalizeUTC(date), amountMinor };
}

describe('xirr — known values', () => {
  it('doubling in exactly one year is 100%', () => {
    const r = xirr([flow('2023-01-01', -100000), flow('2024-01-01', 200000)]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(1.0, 6);
  });

  it('halving in exactly one year is −50%', () => {
    const r = xirr([flow('2023-01-01', -100000), flow('2024-01-01', 50000)]);
    expect(r!).toBeCloseTo(-0.5, 6);
  });

  it("matches Excel's documented XIRR example", () => {
    // Excel XIRR docs: -10000, 2750, 4250, 3250, 2750 → 0.373362535
    const r = xirr([
      flow('2008-01-01', -1000000),
      flow('2008-03-01', 275000),
      flow('2008-10-30', 425000),
      flow('2009-02-15', 325000),
      flow('2009-04-01', 275000),
    ]);
    expect(r!).toBeCloseTo(0.373362535, 6);
  });

  it('sub-year holding annualizes: +10% over 183 days', () => {
    const r = xirr([flow('2025-01-01', -100000), flow('2025-07-03', 110000)]);
    expect(r!).toBeCloseTo(Math.pow(1.1, 365 / 183) - 1, 6);
  });

  it('irregular multi-year gap: 1.5× over ~3.45 years', () => {
    // 2020-01-01 → 2023-06-15 = 1261 days
    const r = xirr([flow('2020-01-01', -100000), flow('2023-06-15', 150000)]);
    expect(r!).toBeCloseTo(Math.pow(1.5, 365 / 1261) - 1, 6);
  });

  it('deeply negative but > −100% converges (bisection territory)', () => {
    const r = xirr([flow('2023-01-01', -100000), flow('2024-01-01', 2000)]);
    expect(r!).toBeCloseTo(-0.98, 6);
  });
});

describe('xirr — no-solution guards', () => {
  it('all-negative stream → null', () => {
    expect(xirr([flow('2024-01-01', -100), flow('2024-06-01', -200)])).toBeNull();
  });

  it('all-positive stream → null', () => {
    expect(xirr([flow('2024-01-01', 100), flow('2024-06-01', 200)])).toBeNull();
  });

  it('empty and single-flow streams → null', () => {
    expect(xirr([])).toBeNull();
    expect(xirr([flow('2024-01-01', -100)])).toBeNull();
  });

  it('zero-amount flows are ignored', () => {
    expect(xirr([flow('2024-01-01', 0), flow('2024-06-01', 0)])).toBeNull();
  });

  it('same-day in/out of equal size → 0%', () => {
    const r = xirr([flow('2024-01-01', -100000), flow('2024-01-01', 100000)]);
    // NPV is 0 for every rate; convention: return 0 rather than an arbitrary root.
    expect(r).toBe(0);
  });
});
