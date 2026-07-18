import { describe, expect, it } from '@jest/globals';

import {
  convertMinor,
  decimalsFor,
  formatMinor,
  fromMinor,
  roundHalfEven,
  toMinor,
} from './money';

describe('decimalsFor', () => {
  it('knows the portfolio currencies', () => {
    expect(decimalsFor('AED')).toBe(2);
    expect(decimalsFor('USD')).toBe(2);
    expect(decimalsFor('JPY')).toBe(0);
  });

  it('throws on unknown currencies instead of guessing', () => {
    expect(() => decimalsFor('XXX')).toThrow(/Unknown currency/);
  });
});

describe('toMinor — string path (exact)', () => {
  it('parses 2-decimal currencies', () => {
    expect(toMinor('1234.56', 'AED')).toBe(123456);
    expect(toMinor('-0.01', 'USD')).toBe(-1);
    expect(toMinor('1,600,000', 'AED')).toBe(160000000);
  });

  it('JPY is 0-decimal — no ×100', () => {
    expect(toMinor('45000', 'JPY')).toBe(45000);
  });

  it('rejects more decimals than the currency allows', () => {
    expect(() => toMinor('100.5', 'JPY')).toThrow(/allows 0/);
    expect(() => toMinor('1.234', 'AED')).toThrow(/allows 2/);
  });

  it('pads short fractions', () => {
    expect(toMinor('7.5', 'AED')).toBe(750);
  });
});

describe('toMinor — number path (rounds half-even)', () => {
  it('rounds computed values at the currency scale', () => {
    expect(toMinor(10.005, 'AED')).toBe(1000); // ties to even
    expect(toMinor(10.015, 'AED')).toBe(1002);
    expect(toMinor(10.006, 'AED')).toBe(1001);
  });
});

describe('roundHalfEven', () => {
  it('ties go to the even neighbour', () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(-2.5)).toBe(-2);
  });

  it('non-ties round normally', () => {
    expect(roundHalfEven(2.4)).toBe(2);
    expect(roundHalfEven(2.6)).toBe(3);
  });
});

describe('fromMinor / formatMinor', () => {
  it('round-trips', () => {
    expect(fromMinor(123456, 'AED')).toBe(1234.56);
    expect(fromMinor(45000, 'JPY')).toBe(45000);
  });

  it('formats at the currency scale', () => {
    expect(formatMinor(160000000, 'AED')).toBe('AED 1,600,000.00');
    expect(formatMinor(45000, 'JPY')).toBe('JPY 45,000');
  });
});

describe('convertMinor', () => {
  it('USD → AED at the peg', () => {
    expect(convertMinor(10000, 'USD', 'AED', 3.6725)).toBe(36725); // $100 → AED 367.25
  });

  it('JPY → AED lands on 2 decimals', () => {
    expect(convertMinor(45000, 'JPY', 'AED', 0.0239)).toBe(107550); // ¥45,000 → AED 1,075.50
  });

  it('AED → JPY lands on 0 decimals', () => {
    expect(convertMinor(107550, 'AED', 'JPY', 41.85)).toBe(45010);
  });
});
