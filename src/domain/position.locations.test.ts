import { describe, expect, it } from '@jest/globals';

import { makeRateSeries } from './fx';
import { aggregateNetWorth, type AssetSnapshot } from './portfolio';
import { positionsByAccount, positionValueMinor } from './position';

/**
 * THE Stage 6 location test (spec §3.1/§9 v6) — mirror image of the
 * net-worth idempotency test, but for location: one AAPL asset with buys
 * on two source_accounts must show as TWO location lines that sum to the
 * combined position.
 */
const aaplTxns = [
  // 10 shares on eToro at $185.30
  { type: 'BUY', date: '2025-01-15', amountMinor: -1853000, hoursSpent: 0.1, quantity: 10, sourceAccount: 'etoro' },
  // 5 shares on Trading212 at $201.10
  { type: 'BUY', date: '2025-04-02', amountMinor: -1005500, hoursSpent: 0.1, quantity: 5, sourceAccount: 'trading212' },
  // sold 2 of the eToro shares
  { type: 'SELL', date: '2025-06-01', amountMinor: 420000, hoursSpent: 0.1, quantity: 2, sourceAccount: 'etoro' },
];

const PRICE = 21240; // $212.40

describe('positionsByAccount', () => {
  const positions = positionsByAccount(aaplTxns);

  it('derives one position per source_account', () => {
    expect(positions).toHaveLength(2);
    const etoro = positions.find((p) => p.account === 'etoro')!;
    const t212 = positions.find((p) => p.account === 'trading212')!;
    expect(etoro.quantity).toBe(8); // 10 bought − 2 sold
    expect(t212.quantity).toBe(5);
  });

  it('per-platform average cost falls out of the same derivation', () => {
    const etoro = positions.find((p) => p.account === 'etoro')!;
    const t212 = positions.find((p) => p.account === 'trading212')!;
    expect(etoro.avgCostMinor).toBe(185300); // $1,853.00 / 10
    expect(t212.avgCostMinor).toBe(201100); // $1,005.50 / 5
  });

  it('income rows do not disturb positions', () => {
    const withDividend = positionsByAccount([
      ...aaplTxns,
      { type: 'DIVIDEND', date: '2025-05-15', amountMinor: 375, hoursSpent: 0, quantity: null, sourceAccount: 'etoro' },
    ]);
    expect(withDividend.find((p) => p.account === 'etoro')!.quantity).toBe(8);
  });
});

describe('by-location allocation derives from source_account, not asset.platform', () => {
  // ONE asset; its asset.platform says 'eToro' (whoever imported first) —
  // and must NOT decide the location view.
  const positions = positionsByAccount(aaplTxns);
  const snapshot: AssetSnapshot = {
    id: 'aapl',
    name: 'Apple Inc.',
    class: 'EQUITY',
    platform: 'eToro',
    valuation: {
      amountMinor: positionValueMinor(13, PRICE), // combined 8 + 5 shares
      currency: 'USD',
      asOf: '2025-07-17',
      stale: false,
    },
    locations: positions.map((p) => ({
      label: p.account ?? 'Unassigned',
      amountMinor: positionValueMinor(p.quantity, PRICE),
    })),
  };
  const rates = { USD: makeRateSeries([{ date: '2025-07-17', rate: 3.6725 }]) };
  const nw = aggregateNetWorth([snapshot], rates, 'AED', '2025-07-17');

  it('shows TWO location lines for the one asset', () => {
    expect(Object.keys(nw.byPlatform).sort()).toEqual(['etoro', 'trading212']);
  });

  it('the two lines sum to the combined position value', () => {
    const sum = Object.values(nw.byPlatform).reduce((a, b) => a + b, 0);
    expect(sum).toBe(nw.totalMinor);
    expect(nw.totalMinor).toBe(nw.perAsset[0].valueMinor);
  });

  it('nothing was collapsed under the asset.platform label', () => {
    expect(nw.byPlatform['eToro']).toBeUndefined();
  });
});
