/** The equity fallback chain: a dead Stooq endpoint (the exact failure
 *  seen on-device: their 404 page / quota text) must degrade to Yahoo,
 *  and only a full chain failure returns null. Network mocked. */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { fetchEquityPrice } from './index';

const YAHOO_BODY = {
  chart: {
    result: [
      { meta: { currency: 'USD', regularMarketPrice: 329.65, regularMarketTime: 1752861600 } },
    ],
  },
};

function mockFetch(handler: (url: string) => Promise<Partial<Response>>) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input) => handler(String(input)) as Promise<Response>);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchEquityPrice — Stooq → Yahoo chain', () => {
  it('healthy Stooq answers without touching Yahoo', async () => {
    const spy = mockFetch(async (url) => {
      expect(url).toContain('stooq.com');
      return {
        ok: true,
        text: async () =>
          'Symbol,Date,Time,Open,High,Low,Close,Volume\nTSLA.US,2026-07-17,22:00:11,320,332,318,329.4,1000\n',
      };
    });
    const point = await fetchEquityPrice('TSLA', 'tsla.us');
    expect(point).toMatchObject({ symbol: 'TSLA', priceMinor: 32940, currency: 'USD' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("Stooq 404/'page does not exist' → Yahoo answers", async () => {
    mockFetch(async (url) => {
      if (url.includes('stooq.com')) return { ok: false };
      expect(url).toContain('query1.finance.yahoo.com/v8/finance/chart/TSLA');
      return { ok: true, json: async () => YAHOO_BODY };
    });
    const point = await fetchEquityPrice('TSLA', 'tsla.us');
    expect(point).toMatchObject({ symbol: 'TSLA', priceMinor: 32965, currency: 'USD' });
  });

  it('Stooq quota-exceeded text → Yahoo answers', async () => {
    mockFetch(async (url) =>
      url.includes('stooq.com')
        ? { ok: true, text: async () => 'Exceeded the daily hits limit' }
        : { ok: true, json: async () => YAHOO_BODY }
    );
    const point = await fetchEquityPrice('TSLA', 'tsla.us');
    expect(point!.priceMinor).toBe(32965);
  });

  it('dashed tickers translate for Yahoo (brk-b.us → BRK-B)', async () => {
    mockFetch(async (url) => {
      if (url.includes('stooq.com')) return { ok: false };
      expect(url).toContain('/chart/BRK-B?');
      return { ok: true, json: async () => YAHOO_BODY };
    });
    await fetchEquityPrice('BRK.B', 'brk-b.us');
  });

  it('whole chain down → null (stale cache path, never a throw)', async () => {
    mockFetch(async () => {
      throw new Error('network down');
    });
    expect(await fetchEquityPrice('TSLA', 'tsla.us')).toBeNull();
  });
});
