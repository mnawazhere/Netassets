/** Pure response parsers for the external providers — unit-testable without
 *  network. Fetching lives in the provider modules; parsing lives here. */
import { toMinor } from '@/domain/money';

/**
 * Stooq single-quote CSV (`/q/l/?s=aapl.us&f=sd2t2ohlcv&h&e=csv`):
 *   Symbol,Date,Time,Open,High,Low,Close,Volume
 *   AAPL.US,2025-07-17,22:00:11,210.1,213.5,209.8,212.4,48123456
 * Returns null on the "N/D" rows Stooq serves for unknown symbols and on
 * its "Exceeded the daily hits limit" plain-text response.
 */
export function parseStooqCsv(
  csv: string,
  currency: string
): { symbol: string; date: string; priceMinor: number } | null {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const cells = lines[1].split(',');
  if (cells.length < 7) return null;
  const [symbol, date, , , , , close] = cells;
  if (!symbol || close === undefined || close === 'N/D' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  const price = Number(close);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { symbol: symbol.replace(/\.US$/i, ''), date, priceMinor: toMinor(price, currency) };
}

/**
 * Stooq daily-history CSV (`/q/d/l/?s=aapl.us&d1=20260710&d2=20260718&i=d`):
 *   Date,Open,High,Low,Close,Volume
 *   2026-07-17,210.1,213.5,209.8,212.4,48123456
 * Returns the LAST row's close — the latest trading day in the requested
 * window (weekends/holidays make the target date itself absent). Null on
 * empty/error bodies, mirroring parseStooqCsv's contract.
 */
export function parseStooqHistoryCsv(
  csv: string,
  currency: string
): { date: string; priceMinor: number } | null {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  for (let i = lines.length - 1; i >= 1; i--) {
    const cells = lines[i].split(',');
    if (cells.length < 5) continue;
    const [date, , , , close] = cells;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const price = Number(close);
    if (!Number.isFinite(price) || price <= 0) continue;
    return { date, priceMinor: toMinor(price, currency) };
  }
  return null;
}

/**
 * Yahoo chart HISTORY (`?interval=1d&period1=<epoch>&period2=<epoch>`):
 * pairs `timestamp[]` with `indicators.quote[0].close[]` and returns the
 * LAST bar with a non-null close — the latest trading day in the window.
 * Null on malformed/empty bodies (chart.error, missing arrays, all-null
 * closes), mirroring parseYahooChart's contract.
 */
export function parseYahooChartHistory(
  body: unknown
): { date: string; priceMinor: number; currency: string } | null {
  const result = (
    body as { chart?: { result?: { meta?: { currency?: string }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } }
  )?.chart?.result?.[0];
  const currency = result?.meta?.currency;
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!currency || !Array.isArray(timestamps) || !Array.isArray(closes)) return null;
  for (let i = closes.length - 1; i >= 0; i--) {
    const close = closes[i];
    const ts = timestamps[i];
    if (typeof close === 'number' && Number.isFinite(close) && close > 0 && typeof ts === 'number') {
      return {
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        priceMinor: toMinor(close, currency),
        currency,
      };
    }
  }
  return null;
}

/**
 * CoinGecko `/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true`:
 *   { "bitcoin": { "usd": 117832, "last_updated_at": 1752741600 } }
 */
export function parseCoinGecko(
  json: unknown,
  id: string,
  vsCurrency: string
): { priceMinor: number; asOf: string } | null {
  const entry = (json as Record<string, Record<string, number>> | null)?.[id];
  const price = entry?.[vsCurrency.toLowerCase()];
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  const ts = entry?.last_updated_at;
  const asOf =
    typeof ts === 'number' ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  return { priceMinor: toMinor(price, vsCurrency), asOf };
}

/**
 * Yahoo Finance v8 chart endpoint
 * (`query1.finance.yahoo.com/v8/finance/chart/TSLA?interval=1d&range=1d`):
 *   { "chart": { "result": [ { "meta": {
 *       "currency": "USD", "regularMarketPrice": 329.65,
 *       "regularMarketTime": 1752861600, ... } } ] } }
 * Keyless equity fallback for when Stooq's CSV endpoint is unreachable.
 */
export function parseYahooChart(
  json: unknown
): { priceMinor: number; currency: string; asOf: string } | null {
  const meta = (
    json as { chart?: { result?: { meta?: Record<string, unknown> }[] } } | null
  )?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const currency = typeof meta?.currency === 'string' ? meta.currency : 'USD';
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  const ts = meta?.regularMarketTime;
  const asOf =
    typeof ts === 'number' ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  try {
    return { priceMinor: toMinor(price, currency), currency: currency.toUpperCase(), asOf };
  } catch {
    return null; // unknown currency code — refuse rather than misprice
  }
}

/**
 * fawazahmed0 exchange-api (`.../v1/currencies/usd.min.json`):
 *   { "date": "2025-07-17", "usd": { "aed": 3.6725, "jpy": 148.61, ... } }
 */
export function parseExchangeApi(
  json: unknown,
  base: string,
  quote: string
): { date: string; rate: number } | null {
  const obj = json as { date?: string } & Record<string, Record<string, number>>;
  const rate = obj?.[base.toLowerCase()]?.[quote.toLowerCase()];
  const date = obj?.date;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, rate };
}
