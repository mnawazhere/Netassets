import { describe, expect, it } from '@jest/globals';

import { normalizeAccount, positionValueMinor, quantityHeld } from './position';

describe('quantityHeld', () => {
  it('sums buys minus sells', () => {
    expect(
      quantityHeld([
        { type: 'BUY', date: '2025-01-01', amountMinor: -1, hoursSpent: 0, quantity: 10 },
        { type: 'BUY', date: '2025-02-01', amountMinor: -1, hoursSpent: 0, quantity: 5 },
        { type: 'SELL', date: '2025-03-01', amountMinor: 1, hoursSpent: 0, quantity: 4 },
        { type: 'DIVIDEND', date: '2025-04-01', amountMinor: 1, hoursSpent: 0, quantity: null },
      ])
    ).toBe(11);
  });

  it('empty stream holds zero', () => {
    expect(quantityHeld([])).toBe(0);
  });
});

describe('normalizeAccount', () => {
  it("canonicalizes so 'eToro' and 'etoro' are ONE location line", () => {
    expect(normalizeAccount(' eToro ')).toBe('etoro');
    expect(normalizeAccount('Trading212')).toBe('trading212');
  });

  it('empty-ish input is null (unassigned), not an empty-string bucket', () => {
    expect(normalizeAccount('')).toBeNull();
    expect(normalizeAccount('   ')).toBeNull();
    expect(normalizeAccount(null)).toBeNull();
    expect(normalizeAccount(undefined)).toBeNull();
  });
});

describe('positionValueMinor', () => {
  it('whole quantities multiply exactly', () => {
    expect(positionValueMinor(15, 21240)).toBe(318600); // 15 × $212.40
  });

  it('fractional quantities round half-even', () => {
    expect(positionValueMinor(0.5, 21241)).toBe(10620); // 10620.5 → even
    expect(positionValueMinor(0.0001, 21240)).toBe(2); // 2.124 → 2
  });
});
