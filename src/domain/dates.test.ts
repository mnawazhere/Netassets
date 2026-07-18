import { describe, expect, it } from '@jest/globals';

import { daysBetween, yearFraction } from './dates';

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween(new Date('2025-01-01'), new Date('2025-01-31'))).toBe(30);
  });

  it('is negative when reversed', () => {
    expect(daysBetween(new Date('2025-01-31'), new Date('2025-01-01'))).toBe(-30);
  });
});

describe('yearFraction (Actual/365)', () => {
  it('one 365-day year is exactly 1', () => {
    expect(yearFraction(new Date('2025-01-01'), new Date('2026-01-01'))).toBe(1);
  });

  it('half-year example', () => {
    expect(yearFraction(new Date('2025-01-01'), new Date('2025-07-03'))).toBeCloseTo(183 / 365, 10);
  });
});
