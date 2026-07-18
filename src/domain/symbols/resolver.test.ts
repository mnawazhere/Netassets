import { describe, expect, it } from '@jest/globals';

import { cacheKeysFor, resolveBinding, type Binding } from './resolver';

describe('resolveBinding — index paths', () => {
  it('exact symbol binds', () => {
    expect(resolveBinding('MSFT', 'EQUITY')).toMatchObject({
      match: 'exact',
      binding: { providerId: 'msft.us' },
    });
  });

  it('exact full name binds', () => {
    expect(resolveBinding('Microsoft Corporation', 'EQUITY')).toMatchObject({
      match: 'exact',
      binding: { providerId: 'msft.us' },
    });
  });

  it("unique dominant name match binds: free-text 'Microsoft'", () => {
    expect(resolveBinding('Microsoft', 'EQUITY')).toMatchObject({
      match: 'dominant', // a hypothesis — callers must gate it (§6 v10)
      binding: { symbol: 'MSFT', providerId: 'msft.us' },
    });
  });

  it('casing/whitespace variants normalize to the same binding', () => {
    const a = resolveBinding(' microsoft ', 'EQUITY');
    const b = resolveBinding('MICROSOFT', 'EQUITY');
    const c = resolveBinding('mSfT', 'EQUITY');
    expect(a!.binding).toEqual(b!.binding);
    expect(a!.binding).toEqual(c!.binding); // same binding; match kind may differ
    expect(a!.match).toBe('dominant');
    expect(c!.match).toBe('exact'); // symbol hit
    expect(a!.binding.providerId).toBe('msft.us');
  });

  it('ambiguous queries are a MISS, never a guess', () => {
    // 'S' matches many names; the resolver must not pick one.
    expect(resolveBinding('S', 'ETF')).toBeNull();
  });

  it('unknown names are a miss', () => {
    expect(resolveBinding('Some Obscure Smallcap', 'EQUITY')).toBeNull();
  });

  it('class scoping holds: MSFT is not a coin', () => {
    expect(resolveBinding('MSFT', 'CRYPTO')).toBeNull();
  });
});

describe('resolveBinding — cache path', () => {
  const cachedBinding: Binding = {
    displayName: 'Obscure Smallcap Inc.',
    symbol: 'OBSC',
    class: 'EQUITY',
    providerId: 'obsc.us',
    currency: 'USD',
  };
  const cache = (key: string) => (key === 'OBSCURE SMALLCAP INC.' || key === 'OBSC' ? cachedBinding : null);

  it('cache serves non-index names, via normalized keys', () => {
    expect(resolveBinding('  obscure smallcap inc. ', 'EQUITY', cache)).toEqual({ binding: cachedBinding, match: 'cached' });
    expect(resolveBinding('obsc', 'EQUITY', cache)).toEqual({ binding: cachedBinding, match: 'cached' });
  });

  it('index wins over cache for the same key (curated data is authoritative)', () => {
    const poisoned = () => cachedBinding;
    expect(resolveBinding('MSFT', 'EQUITY', poisoned)!).toMatchObject({ match: 'exact', binding: { providerId: 'msft.us' } });
  });
});

describe('cacheKeysFor', () => {
  it('covers symbol, display name, and the original query, normalized + deduped', () => {
    const binding: Binding = {
      displayName: 'Microsoft Corporation',
      symbol: 'MSFT',
      class: 'EQUITY',
      providerId: 'msft.us',
      currency: 'USD',
    };
    expect(cacheKeysFor(binding, ' microsoft ').sort()).toEqual([
      'MICROSOFT',
      'MICROSOFT CORPORATION',
      'MSFT',
    ]);
    // Query identical to the symbol dedupes away.
    expect(cacheKeysFor(binding, 'msft').sort()).toEqual(['MICROSOFT CORPORATION', 'MSFT']);
  });
});
