import { describe, expect, it } from '@jest/globals';

import { markValuation } from './marks';
import { marketValuation } from './market';

describe('marketValuation', () => {
  it('quantity held × cached price, native currency', () => {
    const v = marketValuation(
      [
        { type: 'BUY', date: '2025-01-15', amountMinor: -185300, hoursSpent: 0.1, quantity: 10 },
        { type: 'BUY', date: '2025-04-02', amountMinor: -100550, hoursSpent: 0.1, quantity: 5 },
      ],
      { symbol: 'AAPL', currency: 'USD', priceMinor: 21240, asOf: '2025-07-17T12:00:00Z' },
      { fresh: true }
    );
    expect(v.amountMinor).toBe(318600); // 15 × $212.40
    expect(v.currency).toBe('USD');
    expect(v.stale).toBe(false);
  });

  it('cache-served price is marked stale', () => {
    const v = marketValuation([], { symbol: 'AAPL', currency: 'USD', priceMinor: 1, asOf: 't' }, { fresh: false });
    expect(v.stale).toBe(true);
  });
});

describe('markValuation', () => {
  it('latest mark wins; series is the history', () => {
    const v = markValuation([
      { date: '2024-06-01', valueMinor: 145000000, currency: 'AED' },
      { date: '2025-06-15', valueMinor: 160000000, currency: 'AED' },
    ]);
    expect(v).not.toBeNull();
    expect(v!.amountMinor).toBe(160000000);
    expect(v!.asOf).toBe('2025-06-15');
    expect(v!.stale).toBe(true);
  });

  it('no marks → null (unvalued asset, surfaced not guessed)', () => {
    expect(markValuation([])).toBeNull();
  });
});
