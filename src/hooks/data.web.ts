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
  marks: { date: string; valueMinor: number; currency: string }[];
  txns: {
    id: string;
    type: string;
    date: string;
    amountMinor: number;
    currency: string;
    hoursSpent: number;
    sourceAccount: string | null;
  }[];
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
  { id: string; name: string; class: AssetClass; currency: string; symbol: string | null }[]
> {
  return [];
}

export async function listKnownAccounts(): Promise<string[]> {
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

export interface PendingConfirmation {
  candidate: {
    binding: { displayName: string; symbol: string; providerId: string; currency: string };
    origin: 'index-dominant' | 'ai';
    forQuery: string;
  };
  fetchedPriceMinor: number;
}

export type ManualResult =
  | { ok: true; priced?: boolean }
  | { ok: false; reason: string }
  | { ok: false; confirmBinding: PendingConfirmation };

export async function submitManualTransaction(
  _entry: ManualEntry,
  _bindingDecision?: { pending: PendingConfirmation; accepted: boolean }
): Promise<ManualResult> {
  return { ok: false, reason: 'Capture is iOS-only' };
}

export interface NavHistoryResult {
  points: { date: string; totalMinor: number }[];
  baseCurrency: string;
}

export function useNavHistory(): { history: NavHistoryResult | null; reload: () => Promise<void> } {
  return { history: null, reload: async () => {} };
}

export interface IncomeResult {
  year: number;
  totalMinor: number;
  byType: Record<string, number>;
  byAsset: { assetId: string; assetName: string; amountMinor: number }[];
  byMonth: number[];
  unconverted: { assetId: string; assetName: string; date: string }[];
  baseCurrency: string;
}

export function useIncome(): { income: IncomeResult | null; reload: () => Promise<void> } {
  return { income: null, reload: async () => {} };
}

export interface LiabilityRow {
  id: string;
  name: string;
  kind: string;
  assetId: string | null;
  currency: string;
  outstandingMinor: number;
  asOf: string;
  note: string | null;
}

export interface SpendRow {
  id: string;
  month: string;
  amountMinor: number;
  currency: string;
  source: string;
  note: string | null;
}

export interface SpendResult {
  year: number;
  byMonth: number[];
  ytdMinor: number;
  monthsRecorded: number;
  avgMonthMinor: number;
  unconverted: { month: string }[];
  baseCurrency: string;
}

export function useSpend() {
  return {
    spend: null as SpendResult | null,
    entries: [] as SpendRow[],
    reload: async () => {},
    recordMonth: async (_m: string, _a: string, _c: string, _s: 'manual' | 'import', _n?: string) => {},
    removeEntry: async (_id: string) => {},
  };
}

export function useLiabilities() {
  return {
    liabilities: [] as LiabilityRow[],
    reload: async () => {},
    saveOutstanding: async (_id: string, _amount: string, _currency: string) => {},
    addLiability: async (
      _name: string,
      _kind: string,
      _amount: string,
      _currency: string,
      _assetId: string | null
    ) => {},
    removeLiability: async (_id: string) => {},
  };
}

export function useAiSettings() {
  return {
    enabled: false,
    hasKey: false,
    setAiEnabled: async (_on: boolean) => {},
    saveKey: async (_key: string) => {},
  };
}

export async function importEtoroCsvFile(): Promise<
  { picked: false } | { picked: true; summary: ImportSummary; unparsed: number }
> {
  return { picked: false };
}

export function useReviewQueue() {
  return {
    items: [] as { id: string; reason: string; payload: string; createdAt: string }[],
    resolve: async (_id: string, _d: 'kept' | 'merged' | 'discarded') => {},
    reload: async () => {},
  };
}

export function useSettingsData() {
  return {
    hourlyRate: '',
    baseCurrency: 'AED',
    timeDefaults: {} as Record<string, string>,
    audit: [] as {
      entity: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      timestamp: string;
      source: string;
    }[],
    salaryMonthly: '',
    expensesMonthly: '',
    saveHourlyRate: async (_v: string) => {},
    saveBaseCurrency: async (_v: string) => {},
    saveTimeDefault: async (_c: string, _h: string) => {},
    saveMonthlyFigure: async (_w: 'salary' | 'expenses', _a: string) => {},
  };
}
