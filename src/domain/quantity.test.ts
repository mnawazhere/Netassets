import { describe, expect, it } from '@jest/globals';

import { deriveQuantity } from './quantity';

/** Assume-at-market capture: qty = amount ÷ unit price, pre-filled and
 *  user-editable. Both sides in minor units of the SAME currency. */
describe('deriveQuantity', () => {
  it('divides amount by unit price', () => {
    // USD 1,000 at USD 425.30/share → 2.351282…
    expect(deriveQuantity(100000, 42530)).toBeCloseTo(2.351281, 6);
  });

  it('uses absolute amount — a signed BUY outflow still yields positive qty', () => {
    expect(deriveQuantity(-100000, 42530)).toBeCloseTo(2.351281, 6);
  });

  it('rounds to 6 decimal places (broker-grade fractional shares)', () => {
    expect(deriveQuantity(100000, 30000)).toBe(3.333333);
  });

  it('returns null for zero/invalid price or amount', () => {
    expect(deriveQuantity(100000, 0)).toBeNull();
    expect(deriveQuantity(100000, -5)).toBeNull();
    expect(deriveQuantity(0, 42530)).toBeNull();
    expect(deriveQuantity(NaN, 42530)).toBeNull();
    expect(deriveQuantity(100000, NaN)).toBeNull();
  });
});
