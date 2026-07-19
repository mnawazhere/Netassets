/**
 * Salary runner (spec §14): NAV projected forward from today's measured
 * position, driven by the §14 input layer (annual net surplus) and
 * per-class growth assumptions.
 *
 * HARD PRINCIPLE: this module is a PROJECTION surface. It reads actuals,
 * never writes them, and its outputs must always be presented as
 * assumption-driven ("what might be"), never as measured NAV.
 *
 * Model (documented simplifications, v1):
 * - Growth compounds annually per class; unknown classes grow 0%.
 * - The year's surplus lands at year END, allocated across classes by
 *   TODAY's weights (empty portfolio → parked as 0%-growth cash).
 * - Liabilities are held constant (no amortization schedule is stored yet).
 * - Low/high band: every class's growth shifted by ∓bandSpread — a blunt,
 *   visible honesty range, not a confidence interval.
 */

export interface ProjectionInput {
  /** Today's gross value per class, base minor units (measured). */
  byClassMinor: Record<string, number>;
  /** Today's total outstanding debt (measured; held constant). */
  liabilitiesMinor: number;
  /** §14 net annual surplus: salary + passive income − spending. */
  annualSurplusMinor: number;
  /** Assumed annual growth per class, e.g. { EQUITY: 0.07 }. */
  growthByClass: Record<string, number>;
  /** ± applied to every growth rate for the low/high curves. */
  bandSpread: number;
  years: number;
}

export interface ProjectionPoint {
  year: number;
  navMinor: number;
  lowMinor: number;
  highMinor: number;
}

const CASH_KEY = '__CASH__';

function runScenario(input: ProjectionInput, growthShift: number): number[] {
  const values: Record<string, number> = { ...input.byClassMinor };
  const grossToday = Object.values(values).reduce((s, v) => s + v, 0);
  // Surplus allocation weights, fixed at today's mix; an empty portfolio
  // parks surplus as cash at 0%.
  const weights: Record<string, number> = {};
  if (grossToday > 0) {
    for (const [cls, v] of Object.entries(values)) weights[cls] = v / grossToday;
  } else {
    weights[CASH_KEY] = 1;
    values[CASH_KEY] = 0;
  }

  const navs: number[] = [];
  navs.push(Object.values(values).reduce((s, v) => s + v, 0) - input.liabilitiesMinor);
  for (let y = 1; y <= input.years; y++) {
    for (const cls of Object.keys(values)) {
      const g = cls === CASH_KEY ? 0 : (input.growthByClass[cls] ?? 0) + growthShift;
      values[cls] = Math.round(values[cls] * (1 + g) + input.annualSurplusMinor * (weights[cls] ?? 0));
    }
    navs.push(Object.values(values).reduce((s, v) => s + v, 0) - input.liabilitiesMinor);
  }
  return navs;
}

export function projectNav(input: ProjectionInput): ProjectionPoint[] {
  const base = runScenario(input, 0);
  const low = runScenario(input, -input.bandSpread);
  const high = runScenario(input, +input.bandSpread);
  return base.map((navMinor, year) => ({
    year,
    navMinor,
    // Year 0 is today's measured NAV — identical across scenarios.
    lowMinor: Math.min(low[year], navMinor),
    highMinor: Math.max(high[year], navMinor),
  }));
}
