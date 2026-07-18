/** App-open / pull-to-refresh entry point (spec §3.1): prices, latest FX,
 *  and any missing historical FX for per-date conversion. Never throws —
 *  offline just means stale cache. */
import type { Db } from '@/db/client';
import { SETTING_KEYS, getSetting } from '@/repositories/settings';

import { backfillHistoricalRates, refreshLatestRates } from './fx';
import { refreshPrices } from './pricing';

export async function refreshAll(db: Db): Promise<void> {
  try {
    const base = (await getSetting(db, SETTING_KEYS.baseCurrency)) ?? 'AED';
    await Promise.all([refreshPrices(db), refreshLatestRates(db, base)]);
    await backfillHistoricalRates(db, base);
  } catch {
    // Offline or provider down: valuations render from cache, marked stale.
  }
}
