/**
 * Web stub — same surface as data.ts with no sqlite. The app is iOS-first
 * (spec §10); the web bundle exists as a build smoke test only.
 */
import type { AssetClass } from '@/db/schema';
import type { ImportSummary } from '@/services/ingestion';
import type { PortfolioView } from '@/services/netWorth';

export function usePortfolio(): {
  view: PortfolioView | null;
  loading: boolean;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  return { view: null, loading: false, reload: async () => {}, refresh: async () => {} };
}

export interface AssetDetail {
  portfolio: PortfolioView;
  entry: PortfolioView['assets'][number] | null;
  marks: Array<{ date: string; valueMinor: number; currency: string }>;
  txns: Array<{
    id: string;
    type: string;
    date: string;
    amountMinor: number;
    currency: string;
    hoursSpent: number;
    sourceAccount: string | null;
  }>;
}

export function useAssetDetail(_assetId: string): { detail: AssetDetail | null } {
  return { detail: null };
}

export const CLASS_HOURS_DEFAULTS: Record<AssetClass, number> = {
  EQUITY: 0.1,
  CRYPTO: 0.1,
  ETF: 0.1,
  PROPERTY: 10,
  COLLECTIBLE: 3,
};

export async function classHoursDefault(cls: AssetClass): Promise<number> {
  return CLASS_HOURS_DEFAULTS[cls];
}

export async function listAssetOptions(): Promise<
  Array<{ id: string; name: string; class: AssetClass; currency: string; symbol: string | null }>
> {
  return [];
}

export interface ManualEntry {
  assetId: string | null;
  newAsset: {
    name: string;
    class: AssetClass;
    symbol: string | null;
    providerId: string | null;
    platform: string | null;
    currency: string;
  } | null;
  type: string;
  date: string;
  amount: string;
  currency: string;
  quantity: number | null;
  hoursSpent: number;
  sourceAccount: string | null;
  note: string | null;
}

export async function submitManualTransaction(
  _entry: ManualEntry
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return { ok: false, reason: 'Capture is iOS-only' };
}

export async function importEtoroCsvFile(): Promise<
  { picked: false } | { picked: true; summary: ImportSummary; unparsed: number }
> {
  return { picked: false };
}

export function useReviewQueue() {
  return {
    items: [] as Array<{ id: string; reason: string; payload: string; createdAt: string }>,
    resolve: async (_id: string, _d: 'kept' | 'merged' | 'discarded') => {},
    reload: async () => {},
  };
}

export function useSettingsData() {
  return {
    hourlyRate: '',
    baseCurrency: 'AED',
    timeDefaults: {} as Record<string, string>,
    audit: [] as Array<{
      entity: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      timestamp: string;
      source: string;
    }>,
    saveHourlyRate: async (_v: string) => {},
    saveBaseCurrency: async (_v: string) => {},
    saveTimeDefault: async (_c: string, _h: string) => {},
  };
}
