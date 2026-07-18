/**
 * Portfolio aggregation (spec §1, §9): net worth in base currency with
 * allocation by class AND by platform/location — both first-class. Pure.
 */
import type { Valuation } from '@/adapters/types';
import { rateOn, type RateSeries } from './fx';
import { convertMinor } from './money';

export interface AssetSnapshot {
  id: string;
  name: string;
  class: string;
  platform: string | null;
  /** Native-currency valuation from the class adapter; null = unvalued. */
  valuation: Valuation | null;
  /**
   * Location slices in native currency (spec §3.1/§9 v6). For market
   * assets these derive from per-source_account positions × shared price —
   * a security split across two brokers is TWO slices. For mark-valued
   * assets it's one slice labeled by asset.platform. Never derived from
   * asset.platform for market assets.
   */
  locations: { label: string; amountMinor: number }[];
}

export interface NetWorth {
  totalMinor: number;
  baseCurrency: string;
  byClass: Record<string, number>;
  byPlatform: Record<string, number>;
  perAsset: { id: string; name: string; valueMinor: number; stale: boolean }[];
  /** Assets with no valuation — surfaced, never silently zeroed. */
  unvalued: { id: string; name: string }[];
}

/**
 * Aggregate snapshots into base-currency net worth. `rates` maps a native
 * currency code to its dated series vs the base; the SPOT (asOf) rate is
 * used here because current value is a today number — historical flows use
 * per-date conversion in the returns engine, not here.
 */
export function aggregateNetWorth(
  snapshots: AssetSnapshot[],
  rates: Record<string, RateSeries>,
  baseCurrency: string,
  asOf: string
): NetWorth {
  const byClass: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  const perAsset: NetWorth['perAsset'] = [];
  const unvalued: NetWorth['unvalued'] = [];
  let total = 0;

  for (const s of snapshots) {
    if (!s.valuation) {
      unvalued.push({ id: s.id, name: s.name });
      continue;
    }
    const native = s.valuation;
    const toBase = (amountMinor: number): number => {
      if (native.currency.toUpperCase() === baseCurrency.toUpperCase()) return amountMinor;
      const series = rates[native.currency.toUpperCase()];
      if (!series) {
        throw new Error(`No ${native.currency}→${baseCurrency} rates loaded`);
      }
      return convertMinor(amountMinor, native.currency, baseCurrency, rateOn(series, asOf));
    };

    const valueMinor = toBase(native.amountMinor);
    total += valueMinor;
    byClass[s.class] = (byClass[s.class] ?? 0) + valueMinor;
    for (const slice of s.locations) {
      byPlatform[slice.label] = (byPlatform[slice.label] ?? 0) + toBase(slice.amountMinor);
    }
    perAsset.push({ id: s.id, name: s.name, valueMinor, stale: native.stale });
  }

  return { totalMinor: total, baseCurrency, byClass, byPlatform, perAsset, unvalued };
}
