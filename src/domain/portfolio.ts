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

/** An outstanding debt (PM tier 1: NAV = assets − liabilities). */
export interface LiabilitySnapshot {
  id: string;
  name: string;
  kind: string;
  /** Asset this debt finances (property equity view); null = unsecured. */
  assetId: string | null;
  currency: string;
  /** Amount owed, POSITIVE, in minor units of `currency`. */
  outstandingMinor: number;
  asOf: string;
}

export interface NetWorth {
  /** NET asset value: assetsTotalMinor − liabilitiesTotalMinor. */
  totalMinor: number;
  /** Gross asset side (the pre-liability total). */
  assetsTotalMinor: number;
  /** Total outstanding debt in base currency. */
  liabilitiesTotalMinor: number;
  baseCurrency: string;
  byClass: Record<string, number>;
  byPlatform: Record<string, number>;
  perAsset: {
    id: string;
    name: string;
    valueMinor: number;
    /** value − outstanding of liabilities linked to this asset (spec: the
     *  property screen shows EQUITY, not gross value). Equals valueMinor
     *  when nothing is linked. */
    equityMinor: number;
    stale: boolean;
  }[];
  perLiability: { id: string; name: string; assetId: string | null; amountMinor: number }[];
  /** Assets with no valuation — surfaced, never silently zeroed. */
  unvalued: { id: string; name: string }[];
  /** Liabilities whose currency has no usable rate series — surfaced, never
   *  guessed at parity or silently dropped. */
  unconvertedLiabilities: { id: string; name: string }[];
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
  asOf: string,
  liabilities: LiabilitySnapshot[] = []
): NetWorth {
  const byClass: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  const perAsset: NetWorth['perAsset'] = [];
  const unvalued: NetWorth['unvalued'] = [];
  const perLiability: NetWorth['perLiability'] = [];
  const unconvertedLiabilities: NetWorth['unconvertedLiabilities'] = [];
  let assetsTotal = 0;

  const spotToBase = (amountMinor: number, currency: string): number | null => {
    if (currency.toUpperCase() === baseCurrency.toUpperCase()) return amountMinor;
    const series = rates[currency.toUpperCase()];
    if (!series) return null;
    return convertMinor(amountMinor, currency, baseCurrency, rateOn(series, asOf));
  };

  for (const s of snapshots) {
    if (!s.valuation) {
      unvalued.push({ id: s.id, name: s.name });
      continue;
    }
    const native = s.valuation;
    const toBase = (amountMinor: number): number => {
      const converted = spotToBase(amountMinor, native.currency);
      if (converted === null) {
        throw new Error(`No ${native.currency}→${baseCurrency} rates loaded`);
      }
      return converted;
    };

    const valueMinor = toBase(native.amountMinor);
    assetsTotal += valueMinor;
    byClass[s.class] = (byClass[s.class] ?? 0) + valueMinor;
    for (const slice of s.locations) {
      byPlatform[slice.label] = (byPlatform[slice.label] ?? 0) + toBase(slice.amountMinor);
    }
    perAsset.push({ id: s.id, name: s.name, valueMinor, equityMinor: valueMinor, stale: native.stale });
  }

  // Liability side: convert at spot like current values (they are today
  // numbers). No usable series → surfaced in unconvertedLiabilities, never
  // parity-guessed (same degradation contract as unvalued assets).
  let liabilitiesTotal = 0;
  for (const l of liabilities) {
    const amountMinor = spotToBase(l.outstandingMinor, l.currency);
    if (amountMinor === null) {
      unconvertedLiabilities.push({ id: l.id, name: l.name });
      continue;
    }
    liabilitiesTotal += amountMinor;
    perLiability.push({ id: l.id, name: l.name, assetId: l.assetId, amountMinor });
    if (l.assetId) {
      const linked = perAsset.find((a) => a.id === l.assetId);
      if (linked) linked.equityMinor -= amountMinor;
    }
  }

  return {
    totalMinor: assetsTotal - liabilitiesTotal,
    assetsTotalMinor: assetsTotal,
    liabilitiesTotalMinor: liabilitiesTotal,
    baseCurrency,
    byClass,
    byPlatform,
    perAsset,
    perLiability,
    unvalued,
    unconvertedLiabilities,
  };
}
