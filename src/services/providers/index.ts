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

import { parseCoinGecko, parseExchangeApi, parseStooqCsv } from './parsers';

const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** US equities / ETFs via Stooq EOD. `providerId` is the Stooq id
 *  (`aapl.us`); when absent, derived from the plain ticker. */
export async function fetchEquityPrice(
  symbol: string,
  providerId?: string | null
): Promise<PricePoint | null> {
  const stooqId = providerId ?? `${symbol.toLowerCase().replace(/\./g, '-')}.us`;
  const res = await fetchWithTimeout(
    `https://stooq.com/q/l/?s=${encodeURIComponent(stooqId)}&f=sd2t2ohlcv&h&e=csv`
  );
  if (!res) return null;
  const parsed = parseStooqCsv(await res.text(), 'USD');
  if (!parsed) return null;
  return { symbol: symbol.toUpperCase(), currency: 'USD', priceMinor: parsed.priceMinor, asOf: parsed.date };
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
