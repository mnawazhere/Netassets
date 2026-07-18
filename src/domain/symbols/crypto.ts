/**
 * Bundled crypto snapshot (offline typeahead, spec §6). providerId is the
 * CoinGecko coin id — the permanent pricing key its API uses (shape
 * `[{id, symbol, name}]` verified live 2026-07 against /coins/list docs).
 * Curated majors; the AI-fallback path (7B-3) covers the long tail.
 */
import type { SecurityEntry } from './types';

const coin = (displayName: string, symbol: string, coingeckoId: string): SecurityEntry => ({
  displayName,
  symbol,
  class: 'CRYPTO',
  exchange: null,
  providerId: coingeckoId,
  currency: 'USD',
});

export const CRYPTO_COINS: SecurityEntry[] = [
  coin('Bitcoin', 'BTC', 'bitcoin'),
  coin('Ethereum', 'ETH', 'ethereum'),
  coin('Tether', 'USDT', 'tether'),
  coin('BNB', 'BNB', 'binancecoin'),
  coin('Solana', 'SOL', 'solana'),
  coin('XRP', 'XRP', 'ripple'),
  coin('USDC', 'USDC', 'usd-coin'),
  coin('Cardano', 'ADA', 'cardano'),
  coin('Dogecoin', 'DOGE', 'dogecoin'),
  coin('Avalanche', 'AVAX', 'avalanche-2'),
  coin('TRON', 'TRX', 'tron'),
  coin('Polkadot', 'DOT', 'polkadot'),
  coin('Chainlink', 'LINK', 'chainlink'),
  coin('Polygon (POL)', 'POL', 'polygon-ecosystem-token'),
  coin('Litecoin', 'LTC', 'litecoin'),
  coin('Shiba Inu', 'SHIB', 'shiba-inu'),
  coin('Bitcoin Cash', 'BCH', 'bitcoin-cash'),
  coin('Uniswap', 'UNI', 'uniswap'),
  coin('Stellar', 'XLM', 'stellar'),
  coin('Monero', 'XMR', 'monero'),
  coin('Ethereum Classic', 'ETC', 'ethereum-classic'),
  coin('Cosmos Hub', 'ATOM', 'cosmos'),
  coin('Filecoin', 'FIL', 'filecoin'),
  coin('Aptos', 'APT', 'aptos'),
  coin('Arbitrum', 'ARB', 'arbitrum'),
  coin('Optimism', 'OP', 'optimism'),
  coin('NEAR Protocol', 'NEAR', 'near'),
  coin('Injective', 'INJ', 'injective-protocol'),
  coin('Sui', 'SUI', 'sui'),
  coin('Sei', 'SEI', 'sei-network'),
  coin('Pepe', 'PEPE', 'pepe'),
  coin('The Graph', 'GRT', 'the-graph'),
  coin('Aave', 'AAVE', 'aave'),
  coin('Maker', 'MKR', 'maker'),
  coin('Algorand', 'ALGO', 'algorand'),
  coin('VeChain', 'VET', 'vechain'),
  coin('Internet Computer', 'ICP', 'internet-computer'),
  coin('Hedera', 'HBAR', 'hedera-hashgraph'),
  coin('Kaspa', 'KAS', 'kaspa'),
  coin('Toncoin', 'TON', 'the-open-network'),
  coin('Immutable', 'IMX', 'immutable-x'),
  coin('Celestia', 'TIA', 'celestia'),
  coin('Stacks', 'STX', 'blockstack'),
  coin('Dai', 'DAI', 'dai'),
  coin('Wrapped Bitcoin', 'WBTC', 'wrapped-bitcoin'),
  coin('Bittensor', 'TAO', 'bittensor'),
  coin('Render', 'RENDER', 'render-token'),
  coin('Ondo', 'ONDO', 'ondo-finance'),
  coin('Worldcoin', 'WLD', 'worldcoin-wld'),
  coin('Jupiter', 'JUP', 'jupiter-exchange-solana'),
];
