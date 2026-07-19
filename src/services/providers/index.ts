/**
 * External data providers (spec §13 decisions — see Stage 4 report):
 * - Equities/ETFs: Stooq EOD CSV (keyless; personal-scale use sits far
 *   under its daily quota). Swappable behind fetchEquityPrice.
 * - Crypto: CoinGecko (keyless public tier; a free Demo key can be added
 *   in settings later if rate limits ever bite).
 * - FX: fawazahmed0 exchange-api via jsDelivr CDN (keyless, no rate limit,
 *   200+ currencies incl. AED/JPY, daily history via date-versioned URLs),
 *   with the pages.dev mirror as fallback. USD→AED additionally has the
 *   central-bank peg (3.6725) as a last-resort constant.
 *
 * Every fetcher returns null on any failure — callers fall back to cache
 * and mark valuations stale. Nothing here throws for network reasons.
 */
import type { PricePoint } from '@/adapters/types';

import {
  parseCoinGecko,
  parseExchangeApi,
  parseStooqCsv,
  parseStooqHistoryCsv,
  parseYahooChart,
  parseYahooChartHistory,
} from './parsers';

const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer); // a throwing fetch must not leave a live timer
  }
}

async function fetchStooqEquity(
  symbol: string,
  stooqId: string
): Promise<PricePoint | null> {
  const res = await fetchWithTimeout(
    `https://stooq.com/q/l/?s=${encodeURIComponent(stooqId)}&f=sd2t2ohlcv&h&e=csv`
  );
  if (!res) return null;
  try {
    const parsed = parseStooqCsv(await res.text(), 'USD');
    if (!parsed) return null;
    return { symbol: symbol.toUpperCase(), currency: 'USD', priceMinor: parsed.priceMinor, asOf: parsed.date };
  } catch {
    return null;
  }
}

async function fetchYahooEquity(
  symbol: string,
  stooqId: string
): Promise<PricePoint | null> {
  // Yahoo uses the dash form Stooq does (BRK-B), minus the '.us' suffix.
  const ySymbol = stooqId.replace(/\.us$/, '').toUpperCase();
  const res = await fetchWithTimeout(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=1d`
  );
  if (!res) return null;
  try {
    const parsed = parseYahooChart(await res.json());
    if (!parsed) return null;
    return { symbol: symbol.toUpperCase(), currency: parsed.currency, priceMinor: parsed.priceMinor, asOf: parsed.asOf };
  } catch {
    return null;
  }
}

/** US equities / ETFs: Stooq EOD first, Yahoo chart as keyless fallback —
 *  one dead endpoint must degrade to the next source, not to a dash.
 *  `providerId` is the Stooq id (`aapl.us`); derived from the ticker when
 *  absent. */
export async function fetchEquityPrice(
  symbol: string,
  providerId?: string | null
): Promise<PricePoint | null> {
  const stooqId = providerId ?? `${symbol.toLowerCase().replace(/\./g, '-')}.us`;
  return (await fetchStooqEquity(symbol, stooqId)) ?? (await fetchYahooEquity(symbol, stooqId));
}

/** US equity/ETF close ON (or the trading day before) `date` (YYYY-MM-DD).
 *  Chain: Stooq daily history → Yahoo chart history (each with a week-long
 *  window to absorb weekends/holidays) → the CURRENT price chain as last
 *  resort. Callers distinguish a fallback by the returned asOf date. */
export async function fetchEquityPriceOn(
  symbol: string,
  date: string,
  providerId?: string | null
): Promise<PricePoint | null> {
  const stooqId = providerId ?? `${symbol.toLowerCase().replace(/\./g, '-')}.us`;
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 7);
  const d1iso = from.toISOString().slice(0, 10);

  const stooqRes = await fetchWithTimeout(
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqId)}&d1=${d1iso.replace(/-/g, '')}&d2=${date.replace(/-/g, '')}&i=d`
  );
  if (stooqRes) {
    try {
      const parsed = parseStooqHistoryCsv(await stooqRes.text(), 'USD');
      if (parsed) {
        return { symbol: symbol.toUpperCase(), currency: 'USD', priceMinor: parsed.priceMinor, asOf: parsed.date };
      }
    } catch {
      // fall through to Yahoo history
    }
  }

  // Yahoo history: period bounds are epoch SECONDS; end is exclusive-ish so
  // pad one day past the target to include it.
  const ySymbol = stooqId.replace(/\.us$/, '').toUpperCase();
  const period1 = Math.floor(new Date(`${d1iso}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000) + 86_400;
  const yahooRes = await fetchWithTimeout(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&period1=${period1}&period2=${period2}`
  );
  if (yahooRes) {
    try {
      const parsed = parseYahooChartHistory(await yahooRes.json());
      if (parsed) {
        return { symbol: symbol.toUpperCase(), currency: parsed.currency, priceMinor: parsed.priceMinor, asOf: parsed.date };
      }
    } catch {
      // fall through to the current-price chain
    }
  }

  return fetchEquityPrice(symbol, providerId);
}

/** Ticker → CoinGecko id for the majors; extend as holdings appear. */
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
};

export function coinGeckoId(symbol: string): string | null {
  return COINGECKO_IDS[symbol.toUpperCase()] ?? null;
}

export async function fetchCryptoPrice(
  symbol: string,
  providerId?: string | null
): Promise<PricePoint | null> {
  const id = providerId ?? coinGeckoId(symbol);
  if (!id) return null;
  const res = await fetchWithTimeout(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_last_updated_at=true`
  );
  if (!res) return null;
  try {
    const parsed = parseCoinGecko(await res.json(), id, 'USD');
    if (!parsed) return null;
    return { symbol: symbol.toUpperCase(), currency: 'USD', priceMinor: parsed.priceMinor, asOf: parsed.asOf };
  } catch {
    return null;
  }
}

const EXCHANGE_API_HOSTS = [
  (v: string, base: string) =>
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${v}/v1/currencies/${base}.min.json`,
  (v: string, base: string) => `https://${v}.currency-api.pages.dev/v1/currencies/${base}.min.json`,
];

/** The dirham peg: USD→AED has traded at 3.6725 since 1997. */
const USD_AED_PEG = 3.6725;

/**
 * Inversion guard (spec §8 v5): a fetched USD→AED rate far from the peg
 * means the series is inverted, mislabeled, or garbage — reject it rather
 * than silently scaling every amount by ~3.67² . Non-pegged pairs can't be
 * checked this cheaply and pass through.
 */
export function isPlausibleRate(base: string, quote: string, rate: number): boolean {
  if (base.toUpperCase() === 'USD' && quote.toUpperCase() === 'AED') {
    return Math.abs(rate - USD_AED_PEG) < 0.1;
  }
  if (base.toUpperCase() === 'AED' && quote.toUpperCase() === 'USD') {
    return Math.abs(rate - 1 / USD_AED_PEG) < 0.01;
  }
  return rate > 0 && Number.isFinite(rate);
}

/**
 * Daily FX rate for one pair. `date` = ISO YYYY-MM-DD for a historical day,
 * or 'latest'. Tries the CDN, then the mirror.
 */
export async function fetchFxRate(
  base: string,
  quote: string,
  date: string | 'latest' = 'latest'
): Promise<{ date: string; rate: number } | null> {
  for (const makeUrl of EXCHANGE_API_HOSTS) {
    const res = await fetchWithTimeout(makeUrl(date, base.toLowerCase()));
    if (!res) continue;
    try {
      const parsed = parseExchangeApi(await res.json(), base, quote);
      if (parsed && isPlausibleRate(base, quote, parsed.rate)) return parsed;
    } catch {
      // fall through to the next host
    }
  }
  // Last resort for the dirham peg only — better than no conversion at all.
  if (base.toUpperCase() === 'USD' && quote.toUpperCase() === 'AED') {
    return { date: date === 'latest' ? new Date().toISOString().slice(0, 10) : date, rate: 3.6725 };
  }
  return null;
}
