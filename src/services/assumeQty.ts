/**
 * Assume-at-market quantity for manual capture: the user enters an amount
 * and a date; we price the security on that date and pre-fill
 * qty = amount ÷ price. The estimate is ALWAYS user-editable — this service
 * only proposes, the qty field stays authoritative.
 */
import { convertMinor, toMinor } from '@/domain/money';
import { deriveQuantity } from '@/domain/quantity';

import { fetchCryptoPrice, fetchEquityPriceOn, fetchFxRate } from './providers';

export interface AssumedQuantity {
  quantity: number;
  /** Unit price used, minor units of `priceCurrency`. */
  priceMinor: number;
  priceCurrency: string;
  /** Trading day the price is from — may differ from the requested date
   *  (weekend/holiday) or be today's (crypto, or history unreachable). */
  priceAsOf: string;
}

/**
 * Null when it cannot price (offline, unknown symbol, no FX for the amount
 * currency) — the caller leaves qty for the user, never guesses.
 */
export async function assumeQuantity(input: {
  symbol: string;
  class: string;
  amountMajor: string;
  amountCurrency: string;
  date: string;
}): Promise<AssumedQuantity | null> {
  const amount = Number(input.amountMajor);
  if (!Number.isFinite(amount) || amount === 0) return null;

  const price =
    input.class === 'CRYPTO'
      ? await fetchCryptoPrice(input.symbol) // spot only — no history source yet
      : await fetchEquityPriceOn(input.symbol, input.date);
  if (!price) return null;

  // Amount and price must share a currency before dividing; work in the
  // price currency's minor scale (domain/money owns per-currency scales).
  const from = input.amountCurrency.toUpperCase();
  const to = price.currency.toUpperCase();
  let amountMinor: number;
  if (from === to) {
    amountMinor = toMinor(input.amountMajor, to);
  } else {
    const fx = await fetchFxRate(from, to);
    if (!fx) return null;
    amountMinor = convertMinor(toMinor(input.amountMajor, from), from, to, fx.rate);
  }

  const quantity = deriveQuantity(amountMinor, price.priceMinor);
  if (quantity === null) return null;

  return {
    quantity,
    priceMinor: price.priceMinor,
    priceCurrency: price.currency,
    priceAsOf: price.asOf,
  };
}
