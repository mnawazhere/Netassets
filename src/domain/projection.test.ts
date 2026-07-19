import { describe, expect, it } from '@jest/globals';

import { projectNav, type ProjectionInput } from './projection';

/** §14 salary runner: NAV projected forward from today, driven by annual
 *  net surplus + per-class growth. PROJECTION ONLY — never writes back. */
const input: ProjectionInput = {
  byClassMinor: { EQUITY: 10000000, PROPERTY: 160000000 }, // 100k + 1.6M
  liabilitiesMinor: 85000000,
  annualSurplusMinor: 12000000, // AED 120k/yr saved
  growthByClass: { EQUITY: 0.07, PROPERTY: 0.04 },
  /** ± band applied to every class's growth for the low/high curves. */
  bandSpread: 0.03,
  years: 10,
};

describe('projectNav', () => {
  const p = projectNav(input);

  it('year 0 is today: gross by-class total minus liabilities, no growth', () => {
    expect(p[0].year).toBe(0);
    expect(p[0].navMinor).toBe(10000000 + 160000000 - 85000000);
    expect(p[0].lowMinor).toBe(p[0].navMinor);
    expect(p[0].highMinor).toBe(p[0].navMinor);
  });

  it('year 1 compounds each class and adds the surplus (allocated by initial weights)', () => {
    const eqWeight = 10000000 / 170000000;
    const propWeight = 160000000 / 170000000;
    const eq1 = 10000000 * 1.07 + 12000000 * eqWeight;
    const prop1 = 160000000 * 1.04 + 12000000 * propWeight;
    expect(p[1].navMinor).toBe(Math.round(eq1) + Math.round(prop1) - 85000000);
  });

  it('produces years 0..N inclusive', () => {
    expect(p.length).toBe(11);
    expect(p[10].year).toBe(10);
  });

  it('low ≤ base ≤ high for every projected year', () => {
    for (const point of p.slice(1)) {
      expect(point.lowMinor).toBeLessThanOrEqual(point.navMinor);
      expect(point.highMinor).toBeGreaterThanOrEqual(point.navMinor);
    }
  });

  it('a negative surplus erodes NAV', () => {
    const eroding = projectNav({ ...input, annualSurplusMinor: -50000000 });
    expect(eroding[3].navMinor).toBeLessThan(eroding[0].navMinor);
  });

  it('unknown class growth defaults to 0% (honest, not guessed)', () => {
    const withCash = projectNav({
      ...input,
      byClassMinor: { ...input.byClassMinor, COLLECTIBLE: 1000000 },
    });
    // Collectible leg exists but no growth assumption → contributes flat
    // (plus its surplus share).
    expect(withCash[0].navMinor).toBe(10000000 + 160000000 + 1000000 - 85000000);
  });

  it('empty portfolio with surplus still accumulates (parked as cash, 0%)', () => {
    const cashOnly = projectNav({
      byClassMinor: {},
      liabilitiesMinor: 0,
      annualSurplusMinor: 1200000,
      growthByClass: {},
      bandSpread: 0.03,
      years: 3,
    });
    expect(cashOnly[3].navMinor).toBe(3600000);
  });
});
