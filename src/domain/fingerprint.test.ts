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

describe('fingerprint with broker transaction ID (spec §6 v3)', () => {
  it('prefers the broker ID: re-import of the same row matches', () => {
    const first = fingerprint({ ...base, sourceTxnId: 'ETORO-778812' });
    const reimport = fingerprint({ ...base, sourceTxnId: 'ETORO-778812' });
    expect(reimport).toBe(first);
  });

  it('two identical same-day trades with different IDs do NOT collide', () => {
    const fill1 = fingerprint({ ...base, sourceTxnId: 'ETORO-778812' });
    const fill2 = fingerprint({ ...base, sourceTxnId: 'ETORO-778813' });
    expect(fill2).not.toBe(fill1);
  });

  it('ID-keyed fingerprint ignores amount/date noise (rounding diffs on re-export)', () => {
    const a = fingerprint({ ...base, sourceTxnId: 'X1' });
    const b = fingerprint({ ...base, sourceTxnId: 'X1', amountMinor: -123457, date: '2025-03-16' });
    expect(b).toBe(a);
  });

  it('same ID on different accounts stays distinct', () => {
    const a = fingerprint({ ...base, sourceTxnId: 'X1', sourceAccount: 'etoro' });
    const b = fingerprint({ ...base, sourceTxnId: 'X1', sourceAccount: 'ibkr' });
    expect(b).not.toBe(a);
  });

  it('identical ID-less trades still collide (routed to review, not dropped)', () => {
    expect(fingerprint({ ...base })).toBe(fingerprint({ ...base }));
  });
});
