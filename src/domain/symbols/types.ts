/** One entry in the bundled symbol index (spec §6 v9). The searchable
 *  fields and the PRICING id are distinct on purpose: Stooq prices
 *  `msft.us`, CoinGecko prices `bitcoin` — never the bare display symbol. */
export interface SecurityEntry {
  displayName: string;
  /** Canonical display symbol (MSFT, BTC). */
  symbol: string;
  class: 'EQUITY' | 'ETF' | 'CRYPTO';
  /** Exchange label for the confirmation card (NASDAQ, NYSE…); crypto: null. */
  exchange: string | null;
  /**
   * Provider pricing id — what the pricing service actually fetches:
   * equities/ETFs: Stooq id `<ticker>.us`; crypto: CoinGecko coin id.
   */
  providerId: string;
  /** Native pricing currency. */
  currency: string;
}
