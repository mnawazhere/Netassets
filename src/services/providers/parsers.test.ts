import { describe, expect, it } from '@jest/globals';

import { parseCoinGecko, parseExchangeApi, parseStooqCsv, parseYahooChart } from './parsers';

describe('parseStooqCsv', () => {
  const good = 'Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2025-07-17,22:00:11,210.1,213.5,209.8,212.4,48123456\n';

  it('parses a quote row', () => {
    expect(parseStooqCsv(good, 'USD')).toEqual({
      symbol: 'AAPL',
      date: '2025-07-17',
      priceMinor: 21240,
    });
  });

  it('unknown symbol (N/D) → null', () => {
    const nd = 'Symbol,Date,Time,Open,High,Low,Close,Volume\nZZZZ.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D\n';
    expect(parseStooqCsv(nd, 'USD')).toBeNull();
  });

  it('quota-exceeded plain text → null, never a crash', () => {
    expect(parseStooqCsv('Exceeded the daily hits limit', 'USD')).toBeNull();
  });
});

describe('parseCoinGecko', () => {
  it('parses price + timestamp', () => {
    const r = parseCoinGecko(
      { bitcoin: { usd: 117832.55, last_updated_at: 1752741600 } },
      'bitcoin',
      'USD'
    );
    expect(r).not.toBeNull();
    expect(r!.priceMinor).toBe(11783255);
    expect(r!.asOf).toBe(new Date(1752741600 * 1000).toISOString());
  });

  it('missing id → null', () => {
    expect(parseCoinGecko({}, 'bitcoin', 'USD')).toBeNull();
  });
});

describe('parseYahooChart', () => {
  const good = {
    chart: {
      result: [
        { meta: { currency: 'USD', regularMarketPrice: 329.65, regularMarketTime: 1752861600 } },
      ],
    },
  };

  it('parses price, currency, and timestamp', () => {
    const r = parseYahooChart(good);
    expect(r).not.toBeNull();
    expect(r!.priceMinor).toBe(32965);
    expect(r!.currency).toBe('USD');
    expect(r!.asOf).toBe(new Date(1752861600 * 1000).toISOString());
  });

  it('missing/invalid price → null', () => {
    expect(parseYahooChart({ chart: { result: [{ meta: { currency: 'USD' } }] } })).toBeNull();
    expect(parseYahooChart({ chart: { result: [] } })).toBeNull();
    expect(parseYahooChart(null)).toBeNull();
    expect(parseYahooChart('an html error page')).toBeNull();
  });

  it('unknown currency code refuses rather than mispricing', () => {
    expect(
      parseYahooChart({ chart: { result: [{ meta: { currency: 'ZZZ', regularMarketPrice: 5 } }] } })
    ).toBeNull();
  });
});

describe('parseExchangeApi', () => {
  const body = { date: '2025-07-17', usd: { aed: 3.6725, jpy: 148.61 } };

  it('extracts the pair rate with its date', () => {
    expect(parseExchangeApi(body, 'USD', 'AED')).toEqual({ date: '2025-07-17', rate: 3.6725 });
    expect(parseExchangeApi(body, 'usd', 'jpy')).toEqual({ date: '2025-07-17', rate: 148.61 });
  });

  it('missing quote currency → null', () => {
    expect(parseExchangeApi(body, 'USD', 'GBP')).toBeNull();
  });

  it('malformed body → null', () => {
    expect(parseExchangeApi('nope', 'USD', 'AED')).toBeNull();
    expect(parseExchangeApi({ usd: { aed: -1 }, date: '2025-07-17' }, 'USD', 'AED')).toBeNull();
  });
});

describe('parseStooqHistoryCsv', () => {
  const { parseStooqHistoryCsv } = require('./parsers');

  it('returns the last trading day close in the window', () => {
    const csv = 'Date,Open,High,Low,Close,Volume\n2026-07-16,420,428,418,425.3,1000\n2026-07-17,426,430,424,428.9,900';
    expect(parseStooqHistoryCsv(csv, 'USD')).toEqual({ date: '2026-07-17', priceMinor: 42890 });
  });

  it('skips malformed trailing rows and falls back to the previous one', () => {
    const csv = 'Date,Open,High,Low,Close,Volume\n2026-07-16,420,428,418,425.3,1000\nNo data';
    expect(parseStooqHistoryCsv(csv, 'USD')).toEqual({ date: '2026-07-16', priceMinor: 42530 });
  });

  it('nulls on empty/error bodies', () => {
    expect(parseStooqHistoryCsv('', 'USD')).toBeNull();
    expect(parseStooqHistoryCsv('Exceeded the daily hits limit', 'USD')).toBeNull();
    expect(parseStooqHistoryCsv('Date,Open,High,Low,Close,Volume', 'USD')).toBeNull();
  });
});
