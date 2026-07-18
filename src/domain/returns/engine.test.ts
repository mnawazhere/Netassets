import { describe, expect, it } from '@jest/globals';

import { toMinor } from '../money';
import { computeAssetReturn, computePortfolioReturn, type AssetReturnInput } from './engine';

/**
 * THE acceptance gate (spec §5 v2/v3): one single input set must reconcile
 * ALL THREE headline metrics — no hand-tuned per-metric fixtures.
 *
 * Rental, one year, all AED:
 *   BUY  −1,600,000  2024-07-01
 *   RENT +10,000 × 4 (quarterly, 30 hrs each = 120 hrs total)
 *   MAINTENANCE −15,000  2025-01-15  (the money cost)
 *   current value 1,600,000 @ 2025-07-01 (flat)
 *   hourly rate AED 300
 *
 *   gross_gain      = 1.6M + 0 + 40k − 1.6M           = +40,000
 *   monetary_costs  = 15,000
 *   labor_cost      = 120 × 300                        = 36,000
 *   true_profit     = 40k − 15k − 36k                  = −11,000
 *   return_per_hour = (40k − 15k) / 120                = 208.33/hr
 */
const AED = (s: string) => toMinor(s, 'AED');

const rental: AssetReturnInput = {
  transactions: [
    { type: 'BUY', date: '2024-07-01', amountMinor: AED('-1600000'), hoursSpent: 0 },
    { type: 'RENT', date: '2024-10-01', amountMinor: AED('10000'), hoursSpent: 30 },
    { type: 'RENT', date: '2025-01-01', amountMinor: AED('10000'), hoursSpent: 30 },
    { type: 'RENT', date: '2025-04-01', amountMinor: AED('10000'), hoursSpent: 30 },
    { type: 'RENT', date: '2025-07-01', amountMinor: AED('10000'), hoursSpent: 30 },
    { type: 'MAINTENANCE', date: '2025-01-15', amountMinor: AED('-15000'), hoursSpent: 0 },
  ],
  currentValueMinor: AED('1600000'),
  asOf: '2025-07-01',
  hourlyRateMinor: AED('300'),
};

describe('computeAssetReturn — spec §5 worked example, one input set', () => {
  const r = computeAssetReturn(rental);

  it('gross gain +40,000', () => {
    expect(r.grossGainMinor).toBe(AED('40000'));
  });

  it('monetary costs 15,000', () => {
    expect(r.monetaryCostsMinor).toBe(AED('15000'));
  });

  it('labor cost 36,000 (120 hrs × 300)', () => {
    expect(r.totalHours).toBe(120);
    expect(r.laborCostMinor).toBe(AED('36000'));
  });

  it('true profit −11,000 — labor treated as a real cost', () => {
    expect(r.trueProfitMinor).toBe(AED('-11000'));
  });

  it('return per hour 208.33 — labor NOT subtracted (no double-count)', () => {
    // minor units per hour: 2,500,000 / 120
    expect(r.returnPerHourMinor).not.toBeNull();
    expect(r.returnPerHourMinor!).toBeCloseTo(2500000 / 120, 6);
    expect(r.returnPerHourMinor! / 100).toBeCloseTo(208.33, 2);
  });

  it('the two headline numbers reconcile from the same components', () => {
    // true_profit = (return_per_hour × hours) − labor_cost, exactly.
    expect(r.returnPerHourMinor! * r.totalHours - r.laborCostMinor).toBeCloseTo(
      r.trueProfitMinor,
      6
    );
  });

  it('XIRR is positive and small (≈25k on 1.6M over a year), labor excluded', () => {
    expect(r.xirr).not.toBeNull();
    expect(r.xirr!).toBeGreaterThan(0.012);
    expect(r.xirr!).toBeLessThan(0.02);
  });

  it('verdict: return/hour < hourly rate → the day job beat it', () => {
    expect(r.returnPerHourMinor!).toBeLessThan(rental.hourlyRateMinor);
  });
});

describe('computeAssetReturn — classification rules', () => {
  it('SELL contributes realized proceeds; sold-out asset needs no terminal value', () => {
    const r = computeAssetReturn({
      transactions: [
        { type: 'BUY', date: '2023-01-01', amountMinor: -100000, hoursSpent: 1 },
        { type: 'SELL', date: '2024-01-01', amountMinor: 150000, hoursSpent: 1 },
      ],
      currentValueMinor: 0,
      asOf: '2024-01-01',
      hourlyRateMinor: 30000,
    });
    expect(r.realizedProceedsMinor).toBe(150000);
    expect(r.costBasisMinor).toBe(100000);
    expect(r.grossGainMinor).toBe(50000);
    expect(r.xirr!).toBeCloseTo(0.5, 6);
  });

  it('FEE reduces XIRR and counts as monetary cost, not cost basis', () => {
    const withFee = computeAssetReturn({
      transactions: [
        { type: 'BUY', date: '2023-01-01', amountMinor: -100000, hoursSpent: 0 },
        { type: 'FEE', date: '2023-01-01', amountMinor: -5000, hoursSpent: 0 },
      ],
      currentValueMinor: 120000,
      asOf: '2024-01-01',
      hourlyRateMinor: 30000,
    });
    expect(withFee.costBasisMinor).toBe(100000);
    expect(withFee.monetaryCostsMinor).toBe(5000);
    expect(withFee.grossGainMinor).toBe(20000);
    // XIRR sees the fee as real cash out: 105k in → 120k out ≈ +14.29%
    expect(withFee.xirr!).toBeCloseTo(120000 / 105000 - 1, 6);
  });

  it('TRANSFER and VALUATION_MARK rows are ignored by the engine', () => {
    const base = computeAssetReturn(rental);
    const withNoise = computeAssetReturn({
      ...rental,
      transactions: [
        ...rental.transactions,
        { type: 'TRANSFER', date: '2025-02-01', amountMinor: -999999, hoursSpent: 0 },
        { type: 'VALUATION_MARK', date: '2025-03-01', amountMinor: 123456, hoursSpent: 0 },
      ],
    });
    expect(withNoise.trueProfitMinor).toBe(base.trueProfitMinor);
    expect(withNoise.xirr).toBeCloseTo(base.xirr!, 10);
  });

  it('zero hours → returnPerHour is null, never a division blow-up', () => {
    const r = computeAssetReturn({
      transactions: [{ type: 'BUY', date: '2024-01-01', amountMinor: -100000, hoursSpent: 0 }],
      currentValueMinor: 110000,
      asOf: '2025-01-01',
      hourlyRateMinor: 30000,
    });
    expect(r.returnPerHourMinor).toBeNull();
    expect(r.laborCostMinor).toBe(0);
  });

  it('labor cost rounds half-even to integer minor units', () => {
    const r = computeAssetReturn({
      transactions: [{ type: 'BUY', date: '2024-01-01', amountMinor: -100000, hoursSpent: 0.1 }],
      currentValueMinor: 100000,
      asOf: '2025-01-01',
      hourlyRateMinor: 30005, // 0.1 × 300.05 = 30.005 → 3000.5 minor → 3000 (even)
    });
    expect(r.laborCostMinor).toBe(3000);
  });
});

describe('computePortfolioReturn', () => {
  it('portfolio = merged streams, summed values, one XIRR', () => {
    const a: AssetReturnInput = {
      transactions: [{ type: 'BUY', date: '2024-01-01', amountMinor: -100000, hoursSpent: 10 }],
      currentValueMinor: 150000,
      asOf: '2025-01-01',
      hourlyRateMinor: 30000,
    };
    const b: AssetReturnInput = {
      transactions: [{ type: 'BUY', date: '2024-01-01', amountMinor: -100000, hoursSpent: 10 }],
      currentValueMinor: 50000,
      asOf: '2025-01-01',
      hourlyRateMinor: 30000,
    };
    const p = computePortfolioReturn([a, b]);
    expect(p.grossGainMinor).toBe(0); // +50k and −50k cancel
    expect(p.totalHours).toBe(20);
    expect(p.trueProfitMinor).toBe(-600000); // labor only: 20 × 300
    // 200k in → 200k out one year later → 0%
    expect(p.xirr!).toBeCloseTo(0, 6);
  });
});
