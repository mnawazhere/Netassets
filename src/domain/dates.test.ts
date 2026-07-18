import { describe, expect, it } from '@jest/globals';

import { daysBetween, normalizeUTC, yearFraction } from './dates';

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween(new Date('2025-01-01'), new Date('2025-01-31'))).toBe(30);
  });

  it('is negative when reversed', () => {
    expect(daysBetween(new Date('2025-01-31'), new Date('2025-01-01'))).toBe(-30);
  });
});

describe('normalizeUTC', () => {
  it('parses ISO date strings to UTC midnight', () => {
    expect(normalizeUTC('2025-03-15').toISOString()).toBe('2025-03-15T00:00:00.000Z');
  });

  it('ignores trailing time components', () => {
    expect(normalizeUTC('2025-03-15T18:42:11+04:00').toISOString()).toBe(
      '2025-03-15T00:00:00.000Z'
    );
  });

  it('keeps the calendar date of a locally-built Date', () => {
    // A Date built from local components keeps its wall-clock calendar date
    // regardless of the runner's timezone.
    const local = new Date(2025, 2, 15, 23, 30); // Mar 15, 23:30 local
    expect(normalizeUTC(local).toISOString()).toBe('2025-03-15T00:00:00.000Z');
  });

  it('rejects non-ISO strings', () => {
    expect(() => normalizeUTC('15/03/2025')).toThrow(/Expected ISO date/);
  });

  it('normalized dates make daysBetween exact across any time noise', () => {
    const a = normalizeUTC('2025-01-01T22:00:00Z');
    const b = normalizeUTC('2025-01-31T02:00:00Z');
    expect(daysBetween(a, b)).toBe(30);
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
