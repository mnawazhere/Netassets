import { describe, expect, it } from '@jest/globals';

import { aggregateNetWorth, type AssetSnapshot } from './portfolio';
import { makeRateSeries } from './fx';

/**
 * The seed portfolio, valued with realistic dated rates — the end-to-end
 * multi-currency proof: USD equity, AED property, JPY collectible, one
 * AED net worth.
 */
const snapshots: AssetSnapshot[] = [
  {
    id: 'aapl',
    name: 'Apple Inc.',
    class: 'EQUITY',
    platform: 'eToro',
    // 15 shares × $212.40 (cached quote)
    valuation: { amountMinor: 318600, currency: 'USD', asOf: '2025-07-17', stale: false },
    locations: [{ label: 'eToro', amountMinor: 318600 }],
  },
  {
    id: 'reeman',
    name: 'Reeman unit',
    class: 'PROPERTY',
    platform: 'Al Reeman',
    valuation: { amountMinor: 160000000, currency: 'AED', asOf: '2025-06-15', stale: true },
    locations: [{ label: 'Al Reeman', amountMinor: 160000000 }],
  },
  {
    id: 'pokemon',
    name: 'Pokémon 151 sealed booster box',
    class: 'COLLECTIBLE',
    platform: 'Home safe',
    valuation: { amountMinor: 45000, currency: 'JPY', asOf: '2025-06-01', stale: true },
    locations: [{ label: 'Home safe', amountMinor: 45000 }],
  },
  {
    id: 'ghost',
    name: 'Unvalued thing',
    class: 'COLLECTIBLE',
    platform: null,
    valuation: null,
    locations: [],
  },
];

const rates = {
  USD: makeRateSeries([
    { date: '2025-01-15', rate: 3.6725 },
    { date: '2025-07-17', rate: 3.6725 }, // the peg
  ]),
  JPY: makeRateSeries([
    { date: '2023-09-22', rate: 0.0246 },
    { date: '2025-07-17', rate: 0.0239 },
  ]),
};

describe('aggregateNetWorth — seed portfolio, per-date spot conversion', () => {
  const nw = aggregateNetWorth(snapshots, rates, 'AED', '2025-07-17');

  it('total: AED property + pegged USD equity + JPY box', () => {
    // AAPL: 318,600¢ × 3.6725 = 1,170,058.35 → 1,170,058 fils (AED 11,700.58)
    // Reeman: 160,000,000 fils
    // Pokémon: ¥45,000 × 0.0239 = 107,550 fils (AED 1,075.50)
    expect(nw.totalMinor).toBe(160000000 + 1170058 + 107550);
  });

  it('allocation by class', () => {
    expect(nw.byClass).toEqual({
      EQUITY: 1170058,
      PROPERTY: 160000000,
      COLLECTIBLE: 107550,
    });
  });

  it('allocation by platform/location — first-class, not an afterthought', () => {
    expect(nw.byPlatform).toEqual({
      eToro: 1170058,
      'Al Reeman': 160000000,
      'Home safe': 107550,
    });
  });

  it('unvalued assets are surfaced, never silently zeroed', () => {
    expect(nw.unvalued).toEqual([{ id: 'ghost', name: 'Unvalued thing' }]);
    expect(nw.perAsset).toHaveLength(3);
  });

  it('missing rate series throws instead of guessing', () => {
    expect(() => aggregateNetWorth(snapshots, { USD: rates.USD }, 'AED', '2025-07-17')).toThrow(
      /JPY/
    );
  });
});
