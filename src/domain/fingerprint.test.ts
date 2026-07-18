import { describe, expect, it } from '@jest/globals';

import { fingerprint, type FingerprintInput } from './fingerprint';

const base: FingerprintInput = {
  assetId: 'a1b2c3',
  date: '2025-03-15',
  type: 'BUY',
  quantity: 10,
  amountMinor: -123456,
  sourceAccount: 'etoro',
};

describe('fingerprint', () => {
  it('is deterministic', () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base }));
  });

  it('is a 16-char hex string', () => {
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when any keyed field changes', () => {
    const fp = fingerprint(base);
    expect(fingerprint({ ...base, date: '2025-03-16' })).not.toBe(fp);
    expect(fingerprint({ ...base, type: 'SELL' })).not.toBe(fp);
    expect(fingerprint({ ...base, quantity: 11 })).not.toBe(fp);
    expect(fingerprint({ ...base, amountMinor: -123457 })).not.toBe(fp);
    expect(fingerprint({ ...base, sourceAccount: 'ibkr' })).not.toBe(fp);
    expect(fingerprint({ ...base, assetId: 'zzz' })).not.toBe(fp);
  });

  it('treats missing quantity/account consistently', () => {
    expect(fingerprint({ ...base, quantity: null })).toBe(
      fingerprint({ ...base, quantity: undefined })
    );
  });
});
