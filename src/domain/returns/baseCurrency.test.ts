import { describe, expect, it } from '@jest/globals';

import { makeRateSeries } from '../fx';
import { computeAssetReturnInBase } from './baseCurrency';

describe('computeAssetReturnInBase — FX effect surfaced, per-date rates', () => {
  it('flat native asset + strengthening currency → gain is PURE FX', () => {
    // $1,000 bought at 3.60, still worth $1,000 at spot 3.80.
    const r = computeAssetReturnInBase({
      transactions: [
        { type: 'BUY', date: '2024-01-02', amountMinor: -100000, hoursSpent: 1 },
      ],
      currentValueMinor: 100000,
      asOf: '2025-01-02',
      currency: 'USD',
      baseCurrency: 'AED',
      rates: makeRateSeries([
        { date: '2024-01-02', rate: 3.6 },
        { date: '2025-01-02', rate: 3.8 },
      ]),
      hourlyRateMinor: 30000,
    });
    // Base: bought AED 3,600, worth AED 3,800 → gross +200 AED.
    expect(r.grossGainMinor).toBe(20000);
    // Native gross is 0 → spot gross 0 → the whole +200 is FX effect.
    expect(r.spotGrossGainMinor).toBe(0);
    expect(r.fxEffectMinor).toBe(20000);
    // Identity: grossGain = spotGross + fxEffect, always.
    expect(r.grossGainMinor).toBe(r.spotGrossGainMinor + r.fxEffectMinor);
    // XIRR is dragged (upward here) by FX: ≈ +5.56% over the year.
    expect(r.xirr!).toBeCloseTo(3800 / 3600 - 1, 2);
  });

  it('flat native asset + weakening currency → FX LOSS shows up', () => {
    // ¥5,800 box: bought at 0.030 (AED 174), spot 0.0239 (AED 138.62).
    const r = computeAssetReturnInBase({
      transactions: [{ type: 'BUY', date: '2023-09-22', amountMinor: -5800, hoursSpent: 5 }],
      currentValueMinor: 5800,
      asOf: '2025-06-01',
      currency: 'JPY',
      baseCurrency: 'AED',
      rates: makeRateSeries([
        { date: '2023-09-22', rate: 0.03 },
        { date: '2025-06-01', rate: 0.0239 },
      ]),
      hourlyRateMinor: 30000,
    });
    expect(r.grossGainMinor).toBe(13862 - 17400); // −3,538 fils = −AED 35.38
    expect(r.spotGrossGainMinor).toBe(0);
    expect(r.fxEffectMinor).toBe(-3538);
    expect(r.grossGainMinor).toBe(r.spotGrossGainMinor + r.fxEffectMinor);
  });

  it('native gain and FX effect decompose cleanly when both move', () => {
    // $1,000 → $1,500 native; rate 3.60 → 3.80.
    const r = computeAssetReturnInBase({
      transactions: [{ type: 'BUY', date: '2024-01-02', amountMinor: -100000, hoursSpent: 0 }],
      currentValueMinor: 150000,
      asOf: '2025-01-02',
      currency: 'USD',
      baseCurrency: 'AED',
      rates: makeRateSeries([
        { date: '2024-01-02', rate: 3.6 },
        { date: '2025-01-02', rate: 3.8 },
      ]),
      hourlyRateMinor: 30000,
    });
    // Base gross: 150000×3.8 − 100000×3.6 = 570000 − 360000 = +210,000 fils.
    expect(r.grossGainMinor).toBe(210000);
    // Native gross +$500 at spot 3.8 → +190,000 fils "asset" gain.
    expect(r.spotGrossGainMinor).toBe(190000);
    // Remainder is FX on the invested capital: +20,000 fils.
    expect(r.fxEffectMinor).toBe(20000);
    expect(r.grossGainMinor).toBe(r.spotGrossGainMinor + r.fxEffectMinor);
  });

  it('same-currency asset: FX effect is exactly zero', () => {
    const r = computeAssetReturnInBase({
      transactions: [{ type: 'BUY', date: '2024-07-01', amountMinor: -160000000, hoursSpent: 0 }],
      currentValueMinor: 160000000,
      asOf: '2025-07-01',
      currency: 'AED',
      baseCurrency: 'AED',
      rates: makeRateSeries([{ date: '2024-01-01', rate: 1 }]),
      hourlyRateMinor: 30000,
    });
    expect(r.fxEffectMinor).toBe(0);
    expect(r.grossGainMinor).toBe(r.spotGrossGainMinor);
  });

  it('money costs convert at their own dates and stay a separate line', () => {
    const r = computeAssetReturnInBase({
      transactions: [
        { type: 'BUY', date: '2024-01-02', amountMinor: -100000, hoursSpent: 0 },
        { type: 'FEE', date: '2024-01-02', amountMinor: -1000, hoursSpent: 0 }, // $10 at 3.60
      ],
      currentValueMinor: 100000,
      asOf: '2025-01-02',
      currency: 'USD',
      baseCurrency: 'AED',
      rates: makeRateSeries([
        { date: '2024-01-02', rate: 3.6 },
        { date: '2025-01-02', rate: 3.8 },
      ]),
      hourlyRateMinor: 30000,
    });
    expect(r.monetaryCostsMinor).toBe(3600); // AED 36.00 at the fee's OWN date
    expect(r.trueProfitMinor).toBe(r.grossGainMinor - r.monetaryCostsMinor - r.laborCostMinor);
  });
});
