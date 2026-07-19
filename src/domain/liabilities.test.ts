import { describe, expect, it } from '@jest/globals';

import { makeRateSeries } from './fx';
import { convertMinor } from './money';
import { aggregateNetWorth, type AssetSnapshot, type LiabilitySnapshot } from './portfolio';

/** NAV = assets − liabilities (PM tier 1): the Reeman unit at 1.6M gross
 *  with an outstanding Ijarah must headline the NET number, and the
 *  property's own line must expose equity, not gross value. */

const reeman: AssetSnapshot = {
  id: 'reeman',
  name: 'Reeman unit',
  class: 'PROPERTY',
  platform: 'Al Reeman',
  valuation: { amountMinor: 160000000, currency: 'AED', asOf: '2025-06-15', stale: false },
  locations: [{ label: 'Al Reeman', amountMinor: 160000000 }],
};

const aapl: AssetSnapshot = {
  id: 'aapl',
  name: 'Apple Inc.',
  class: 'EQUITY',
  platform: 'eToro',
  valuation: { amountMinor: 318600, currency: 'USD', asOf: '2025-07-17', stale: false },
  locations: [{ label: 'eToro', amountMinor: 318600 }],
};

const ijarah: LiabilitySnapshot = {
  id: 'ijarah',
  name: 'ADIB Ijarah — Reeman unit',
  kind: 'PROPERTY_FINANCE',
  assetId: 'reeman',
  currency: 'AED',
  outstandingMinor: 85000000, // AED 850,000 owed
  asOf: '2025-07-01',
};

const rates = {
  USD: makeRateSeries([{ date: '2025-07-17', rate: 3.6725 }]),
};

describe('aggregateNetWorth — liability side', () => {
  const nw = aggregateNetWorth([reeman, aapl], rates, 'AED', '2025-07-17', [ijarah]);

  it('subtracts outstanding liabilities from the headline total', () => {
    const aaplAed = convertMinor(318600, 'USD', 'AED', 3.6725);
    expect(nw.assetsTotalMinor).toBe(160000000 + aaplAed);
    expect(nw.liabilitiesTotalMinor).toBe(85000000);
    expect(nw.totalMinor).toBe(160000000 + aaplAed - 85000000);
  });

  it('keeps byClass gross (allocation is an asset view, not an equity view)', () => {
    expect(nw.byClass.PROPERTY).toBe(160000000);
  });

  it('lists each liability with its base-converted amount', () => {
    expect(nw.perLiability).toEqual([
      { id: 'ijarah', name: 'ADIB Ijarah — Reeman unit', assetId: 'reeman', amountMinor: 85000000 },
    ]);
  });

  it('exposes per-asset equity for linked assets: value − outstanding', () => {
    const entry = nw.perAsset.find((a) => a.id === 'reeman');
    expect(entry?.equityMinor).toBe(160000000 - 85000000);
    // Unlinked assets: equity is just value.
    const apple = nw.perAsset.find((a) => a.id === 'aapl');
    expect(apple?.equityMinor).toBe(apple?.valueMinor);
  });

  it('converts foreign-currency liabilities at the spot rate', () => {
    const usdCard: LiabilitySnapshot = {
      id: 'card',
      name: 'USD card',
      kind: 'CREDIT_CARD',
      assetId: null,
      currency: 'USD',
      outstandingMinor: 100000, // $1,000
      asOf: '2025-07-17',
    };
    const withCard = aggregateNetWorth([reeman], {...rates}, 'AED', '2025-07-17', [usdCard]);
    expect(withCard.liabilitiesTotalMinor).toBe(convertMinor(100000, 'USD', 'AED', 3.6725));
  });

  it('surfaces unconvertible liabilities instead of silently dropping them', () => {
    const chfLoan: LiabilitySnapshot = {
      id: 'chf',
      name: 'CHF loan',
      kind: 'LOAN',
      assetId: null,
      currency: 'CHF',
      outstandingMinor: 500000,
      asOf: '2025-07-17',
    };
    const nw2 = aggregateNetWorth([reeman], rates, 'AED', '2025-07-17', [chfLoan]);
    expect(nw2.unconvertedLiabilities).toEqual([{ id: 'chf', name: 'CHF loan' }]);
    expect(nw2.liabilitiesTotalMinor).toBe(0); // not guessed, surfaced
  });

  it('is backward compatible: omitting liabilities keeps the old totals', () => {
    const nw3 = aggregateNetWorth([reeman, aapl], rates, 'AED', '2025-07-17');
    expect(nw3.totalMinor).toBe(nw3.assetsTotalMinor);
    expect(nw3.liabilitiesTotalMinor).toBe(0);
    expect(nw3.perLiability).toEqual([]);
  });

  it('never lets a liability push a missing-asset equity below its own value silently', () => {
    // Liability linked to an asset that is unvalued: equity cannot be computed,
    // but the debt still reduces NAV.
    const ghost: AssetSnapshot = {
      id: 'ghost',
      name: 'Unvalued property',
      class: 'PROPERTY',
      platform: null,
      valuation: null,
      locations: [],
    };
    const ghostDebt: LiabilitySnapshot = { ...ijarah, id: 'g', assetId: 'ghost' };
    const nw4 = aggregateNetWorth([ghost], rates, 'AED', '2025-07-17', [ghostDebt]);
    expect(nw4.liabilitiesTotalMinor).toBe(85000000);
    expect(nw4.totalMinor).toBe(-85000000);
  });
});
