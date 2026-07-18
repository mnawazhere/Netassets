/** Assembles db rows → adapter valuations → base-currency net worth and
 *  per-asset return breakdowns. Thin glue; all math lives in domain/. */
import { markValuation, marketValuation } from '@/adapters';
import type { Valuation } from '@/adapters/types';
import type { Db } from '@/db/client';
import { makeRateSeries, type RateSeries } from '@/domain/fx';
import { aggregateNetWorth, type AssetSnapshot, type NetWorth } from '@/domain/portfolio';
import {
  computeAssetReturnInBase,
  type BaseReturnBreakdown,
} from '@/domain/returns/baseCurrency';
import { isMarketPriced } from '@/adapters';
import { listAssets, transactionsFor, valuationMarksFor } from '@/repositories/assets';
import { SETTING_KEYS, getSetting } from '@/repositories/settings';

import { getRateSeries } from './fx';
import { cachedPrice } from './pricing';

const FRESH_WINDOW_MS = 15 * 60 * 1000;

async function valuationFor(db: Db, asset: Awaited<ReturnType<typeof listAssets>>[number]): Promise<Valuation | null> {
  if (isMarketPriced(asset.class) && asset.symbol) {
    const price = await cachedPrice(db, asset.symbol);
    if (!price) return null;
    const txns = await transactionsFor(db, asset.id);
    const fresh = Date.now() - new Date(price.asOf).getTime() < FRESH_WINDOW_MS;
    return marketValuation(txns, price, { fresh });
  }
  const marks = await valuationMarksFor(db, asset.id);
  return markValuation(marks);
}

export interface PortfolioView {
  netWorth: NetWorth;
  baseCurrency: string;
  returns: Array<{ assetId: string; name: string; breakdown: BaseReturnBreakdown | null }>;
}

export async function computePortfolioView(db: Db, today: string): Promise<PortfolioView> {
  const baseCurrency = (await getSetting(db, SETTING_KEYS.baseCurrency)) ?? 'AED';
  const hourlyRateMinor = Number((await getSetting(db, SETTING_KEYS.hourlyRateMinor)) ?? '0');
  const all = await listAssets(db);

  const snapshots: AssetSnapshot[] = [];
  const rates: Record<string, RateSeries> = {};
  const returns: PortfolioView['returns'] = [];

  for (const asset of all) {
    const currency = asset.currency.toUpperCase();
    if (currency !== baseCurrency.toUpperCase() && !rates[currency]) {
      rates[currency] = await getRateSeries(db, currency, baseCurrency);
    }

    const valuation = await valuationFor(db, asset);
    snapshots.push({
      id: asset.id,
      name: asset.name,
      class: asset.class,
      platform: asset.platform,
      valuation,
    });

    if (valuation) {
      const txns = await transactionsFor(db, asset.id);
      returns.push({
        assetId: asset.id,
        name: asset.name,
        breakdown: computeAssetReturnInBase({
          transactions: txns,
          currentValueMinor: valuation.amountMinor,
          asOf: today,
          currency: valuation.currency,
          baseCurrency,
          rates: rates[valuation.currency.toUpperCase()] ?? makeRateSeries([{ date: today, rate: 1 }]),
          hourlyRateMinor,
        }),
      });
    } else {
      returns.push({ assetId: asset.id, name: asset.name, breakdown: null });
    }
  }

  return {
    netWorth: aggregateNetWorth(snapshots, rates, baseCurrency, today),
    baseCurrency,
    returns,
  };
}
