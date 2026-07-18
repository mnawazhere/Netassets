import { describe, expect, it } from '@jest/globals';

import { CRYPTO_COINS } from './crypto';
import { US_EQUITIES, US_ETFS } from './equities';
import { SYMBOL_INDEX, lookupExact, searchSymbols } from './search';

describe('7B-1 acceptance — offline typeahead resolution', () => {
  it("'microsoft' resolves to MSFT with the Stooq pricing id", () => {
    const [top] = searchSymbols('microsoft');
    expect(top).toMatchObject({
      symbol: 'MSFT',
      displayName: 'Microsoft Corporation',
      providerId: 'msft.us', // the pricing key, not the display symbol
      class: 'EQUITY',
      exchange: 'NASDAQ',
    });
  });

  it("'msft' resolves to the same canonical entry", () => {
    const [top] = searchSymbols('msft');
    expect(top.symbol).toBe('MSFT');
    expect(top.providerId).toBe('msft.us');
  });

  it("'bitcoin' and 'btc' resolve to the CoinGecko coin id", () => {
    expect(searchSymbols('bitcoin')[0]).toMatchObject({ symbol: 'BTC', providerId: 'bitcoin' });
    expect(searchSymbols('btc')[0]).toMatchObject({ symbol: 'BTC', providerId: 'bitcoin' });
  });

  it('is pure data — no network, by construction', () => {
    // The module graph is static arrays + string math; assert the index is
    // bundled and non-trivial rather than fetched.
    expect(SYMBOL_INDEX.length).toBeGreaterThan(150);
  });

  it('exact symbol beats name-substring matches', () => {
    // 'V' is Visa's symbol and a substring of many names.
    expect(searchSymbols('v')[0].symbol).toBe('V');
  });

  it('class filter scopes results', () => {
    const etfOnly = searchSymbols('s', { class: 'ETF' });
    expect(etfOnly.length).toBeGreaterThan(0);
    expect(etfOnly.every((e) => e.class === 'ETF')).toBe(true);
  });

  it('empty/garbage queries return nothing instead of everything', () => {
    expect(searchSymbols('')).toEqual([]);
    expect(searchSymbols('   ')).toEqual([]);
    expect(searchSymbols('zzzzqqqq')).toEqual([]);
  });

  it('lookupExact: normalized symbol or full name, class-scoped', () => {
    expect(lookupExact(' msft ', 'EQUITY')?.providerId).toBe('msft.us');
    expect(lookupExact('Microsoft Corporation', 'EQUITY')?.providerId).toBe('msft.us');
    expect(lookupExact('MSFT', 'CRYPTO')).toBeNull();
  });
});

describe('snapshot integrity — ids match the live-verified provider shapes', () => {
  it('every equity/ETF providerId is the Stooq form <lowercase>.us', () => {
    for (const e of [...US_EQUITIES, ...US_ETFS]) {
      expect(e.providerId).toMatch(/^[a-z0-9-]+\.us$/);
      expect(e.providerId).toBe(`${e.symbol.toLowerCase().replace(/\./g, '-')}.us`);
      expect(e.currency).toBe('USD');
      expect(e.exchange).toBeTruthy();
    }
  });

  it('every crypto providerId is a CoinGecko id (lowercase kebab), not the ticker', () => {
    for (const c of CRYPTO_COINS) {
      expect(c.providerId).toMatch(/^[a-z0-9-]+$/);
      expect(c.exchange).toBeNull();
    }
    // The distinction that motivates the whole feature:
    expect(CRYPTO_COINS.find((c) => c.symbol === 'BTC')!.providerId).not.toBe('btc');
  });

  it('no duplicate symbol within a class, no duplicate providerIds at all', () => {
    const byClassSymbol = new Set<string>();
    const providerIds = new Set<string>();
    for (const e of SYMBOL_INDEX) {
      const key = `${e.class}:${e.symbol}`;
      expect(byClassSymbol.has(key)).toBe(false);
      byClassSymbol.add(key);
      expect(providerIds.has(`${e.class === 'CRYPTO' ? 'cg' : 'stooq'}:${e.providerId}`)).toBe(false);
      providerIds.add(`${e.class === 'CRYPTO' ? 'cg' : 'stooq'}:${e.providerId}`);
    }
  });
});
