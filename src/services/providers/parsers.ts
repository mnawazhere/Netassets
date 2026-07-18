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
