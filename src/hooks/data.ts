/**
 * ALL screen-facing data access lives here (native). The .web.ts sibling
 * stubs the same interface so the web bundle never imports sqlite.
 * Screens import ONLY from '@/hooks/data'.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as React from 'react';

import { db } from '@/db/client';
import { transactions } from '@/db/schema';
import type { AssetClass, TransactionType } from '@/db/schema';
import { normalizeAccount } from '@/domain/position';
import { parseEtoroCsv } from '@/domain/ingestion/etoro';
import { toMinor } from '@/domain/money';
import { todayISO } from '@/lib/format';
import { changesFor } from '@/repositories/changeLog';
import { listAssets, valuationMarksFor } from '@/repositories/assets';
import { SETTING_KEYS_AI } from '@/services/aiSettings';
import { prepareManualBinding, type PendingConfirmation } from '@/services/bindingFlow';
import { primePrice, refreshPriceFor } from '@/services/pricing';
import { ensureAsset } from '@/services/resolution';
import { getAnthropicKey, setAnthropicKey } from '@/services/secureKeys';
import { pendingReviews, resolveReview } from '@/repositories/reviewQueue';
import { SETTING_KEYS, getSetting, setSetting } from '@/repositories/settings';
import { insertTransaction } from '@/repositories/transactions';
import { runImport, type ImportSummary } from '@/services/ingestion';
import { computePortfolioView, type PortfolioView } from '@/services/netWorth';
import { refreshAll } from '@/services/refresh';

// ---------- portfolio ----------

export function usePortfolio(): {
  view: PortfolioView | null;
  loading: boolean;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [view, setView] = React.useState<PortfolioView | null>(null);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    setView(await computePortfolioView(db, todayISO()));
    setLoading(false);
  }, []);

  const refresh = React.useCallback(async () => {
    await refreshAll(db);
    await reload();
  }, [reload]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return { view, loading, reload, refresh };
}

// ---------- asset detail ----------

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

export function useAssetDetail(assetId: string): { detail: AssetDetail | null } {
  const [detail, setDetail] = React.useState<AssetDetail | null>(null);
  React.useEffect(() => {
    void (async () => {
      const portfolio = await computePortfolioView(db, todayISO());
      const entry = portfolio.assets.find((a) => a.id === assetId) ?? null;
      const marks = await valuationMarksFor(db, assetId);
      const { transactionsFor } = await import('@/repositories/assets');
      const txns = await transactionsFor(db, assetId);
      setDetail({
        portfolio,
        entry,
        marks: marks
          .map((m) => ({ date: m.date, valueMinor: m.valueMinor, currency: m.currency }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        txns: txns.sort((a, b) => b.date.localeCompare(a.date)),
      });
    })();
  }, [assetId]);
  return { detail };
}

// ---------- capture ----------

export const CLASS_HOURS_DEFAULTS: Record<AssetClass, number> = {
  EQUITY: 0.1,
  CRYPTO: 0.1,
  ETF: 0.1,
  PROPERTY: 10,
  COLLECTIBLE: 3,
};

export async function classHoursDefault(cls: AssetClass): Promise<number> {
  const stored = await getSetting(db, `time_default_${cls}`);
  return stored !== null ? Number(stored) : CLASS_HOURS_DEFAULTS[cls];
}

export async function listAssetOptions() {
  return (await listAssets(db)).map((a) => ({
    id: a.id,
    name: a.name,
    class: a.class,
    currency: a.currency,
    symbol: a.symbol,
  }));
}

/** Accounts already seen on transactions — the chips for "where held". */
export async function listKnownAccounts(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ sourceAccount: transactions.sourceAccount })
    .from(transactions);
  return rows
    .map((r) => r.sourceAccount)
    .filter((a): a is string => a !== null && a !== '')
    .sort();
}

export interface ManualEntry {
  assetId: string | null;
  newAsset: {
    name: string;
    class: AssetClass;
    symbol: string | null;
    /** Provider pricing id from the symbol index (§6); null = unpriced. */
    providerId: string | null;
    platform: string | null;
    currency: string;
  } | null;
  type: TransactionType;
  date: string;
  /** Decimal string in the asset currency, always positive; sign from type. */
  amount: string;
  currency: string;
  quantity: number | null;
  hoursSpent: number;
  sourceAccount: string | null;
  note: string | null;
}

const NEGATIVE_TYPES = new Set<TransactionType>(['BUY', 'FEE', 'MAINTENANCE']);

export type ManualResult =
  | { ok: true }
  | { ok: false; reason: string }
  | { ok: false; confirmBinding: PendingConfirmation };

/**
 * `bindingDecision` carries the answer from a prior confirmation card:
 * 'accepted' binds the candidate; 'declined' creates unpriced.
 */
export async function submitManualTransaction(
  entry: ManualEntry,
  bindingDecision?: { pending: PendingConfirmation; accepted: boolean }
): Promise<ManualResult> {
  try {
    let assetId = entry.assetId;
    if (!assetId) {
      if (!entry.newAsset) return { ok: false, reason: 'Pick an asset or create one' };
      let hint: Parameters<typeof ensureAsset>[1] = {
        name: entry.newAsset.name,
        symbol: entry.newAsset.symbol,
        class: entry.newAsset.class,
        platform: entry.newAsset.platform,
        currency: entry.newAsset.currency,
        providerId: entry.newAsset.providerId,
      };
      let mappingSource: 'index' | 'ai' = 'index';
      let onDominant: 'confirm' | 'unpriced' = 'confirm';

      if (bindingDecision?.accepted) {
        // Gate 2 passed — enrich the hint with the confirmed binding.
        const b = bindingDecision.pending.candidate.binding;
        hint = { ...hint, name: b.displayName, symbol: b.symbol, providerId: b.providerId, currency: b.currency };
        mappingSource = bindingDecision.pending.candidate.origin === 'ai' ? 'ai' : 'index';
      } else if (bindingDecision) {
        onDominant = 'unpriced'; // user said no — track unpriced
      } else {
        // First pass: run the gate decision point (§6 v10).
        const prep = await prepareManualBinding(db, hint);
        if (prep.kind === 'confirm') return { ok: false, confirmBinding: prep.pending };
        hint = prep.hint;
        if (prep.kind === 'unpriced') onDominant = 'unpriced';
      }

      const ensured = await ensureAsset(db, hint, {
        onDominant,
        mappingSource,
        allowUnpricedMarket: true,
      });
      if (ensured.outcome === 'needs-confirmation') {
        // Belt-and-braces — prepareManualBinding already surfaced this.
        return { ok: false, reason: 'Binding needs confirmation' };
      }
      assetId = ensured.assetId;

      // Price the new asset NOW, not on the next app open — a bound
      // market asset must never sit valueless on its detail screen.
      if (hint.providerId && hint.symbol) {
        if (bindingDecision?.accepted) {
          await primePrice(db, {
            symbol: hint.symbol,
            currency: hint.currency,
            priceMinor: bindingDecision.pending.fetchedPriceMinor,
          });
        } else {
          await refreshPriceFor(db, {
            class: hint.class,
            symbol: hint.symbol,
            providerId: hint.providerId,
          }); // offline → stays unvalued until refresh; never throws
        }
      }
    }
    const magnitude = Math.abs(toMinor(entry.amount, entry.currency));
    await insertTransaction(
      db,
      {
        assetId,
        type: entry.type,
        date: entry.date,
        amountMinor: NEGATIVE_TYPES.has(entry.type) ? -magnitude : magnitude,
        currency: entry.currency.toUpperCase(),
        quantity: entry.quantity,
        hoursSpent: entry.hoursSpent,
        sourceAccount: normalizeAccount(entry.sourceAccount),
        sourceTxnId: null,
        sourceRef: null,
        note: entry.note,
      },
      'manual'
    );
    return { ok: true };
  } catch (e) {
    if (String(e).toLowerCase().includes('unique')) {
      return { ok: false, reason: 'Duplicate of an existing transaction (same fingerprint)' };
    }
    return { ok: false, reason: String(e instanceof Error ? e.message : e) };
  }
}

export async function importEtoroCsvFile(): Promise<
  { picked: false } | { picked: true; summary: ImportSummary; unparsed: number }
> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'public.comma-separated-values-text'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets[0]) return { picked: false };
  const asset = res.assets[0];
  const csv = await new File(asset.uri).text();
  const parsed = parseEtoroCsv(csv);
  const summary = await runImport(db, {
    fileName: asset.name ?? 'etoro.csv',
    kind: 'csv',
    platform: 'eToro',
    sourceAccount: 'etoro',
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rows: parsed.transactions,
  });
  return { picked: true, summary, unparsed: parsed.unparsed.length };
}

// ---------- review queue ----------

export function useReviewQueue() {
  const [items, setItems] = React.useState<
    Array<{ id: string; reason: string; payload: string; createdAt: string }>
  >([]);

  const reload = React.useCallback(async () => {
    setItems(await pendingReviews(db));
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const resolve = React.useCallback(
    async (id: string, decision: 'kept' | 'merged' | 'discarded') => {
      await resolveReview(db, id, decision);
      await reload();
    },
    [reload]
  );

  return { items, resolve, reload };
}

// ---------- settings ----------

export function useSettingsData() {
  const [hourlyRate, setHourlyRateState] = React.useState<string>('');
  const [baseCurrency, setBaseCurrencyState] = React.useState<string>('AED');
  const [timeDefaults, setTimeDefaults] = React.useState<Record<string, string>>({});
  const [audit, setAudit] = React.useState<
    Array<{ entity: string; field: string; oldValue: string | null; newValue: string | null; timestamp: string; source: string }>
  >([]);

  const reload = React.useCallback(async () => {
    const rate = await getSetting(db, SETTING_KEYS.hourlyRateMinor);
    setHourlyRateState(rate !== null ? String(Number(rate) / 100) : '');
    setBaseCurrencyState((await getSetting(db, SETTING_KEYS.baseCurrency)) ?? 'AED');
    const defaults: Record<string, string> = {};
    for (const cls of Object.keys(CLASS_HOURS_DEFAULTS) as AssetClass[]) {
      defaults[cls] = String(await classHoursDefault(cls));
    }
    setTimeDefaults(defaults);
    setAudit((await changesFor(db, 'settings', SETTING_KEYS.hourlyRateMinor)).slice(0, 10));
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const saveHourlyRate = React.useCallback(
    async (aedPerHour: string) => {
      await setSetting(db, SETTING_KEYS.hourlyRateMinor, String(toMinor(aedPerHour, 'AED')), 'manual');
      await reload();
    },
    [reload]
  );

  const saveBaseCurrency = React.useCallback(
    async (code: string) => {
      await setSetting(db, SETTING_KEYS.baseCurrency, code.toUpperCase(), 'manual');
      await reload();
    },
    [reload]
  );

  const saveTimeDefault = React.useCallback(
    async (cls: string, hours: string) => {
      await setSetting(db, `time_default_${cls}`, hours, 'manual');
      await reload();
    },
    [reload]
  );

  return {
    hourlyRate,
    baseCurrency,
    timeDefaults,
    audit,
    saveHourlyRate,
    saveBaseCurrency,
    saveTimeDefault,
  };
}

// ---------- AI settings (toggle = audited setting; KEY = Keychain ONLY) ----------

export function useAiSettings() {
  const [enabled, setEnabled] = React.useState(false);
  const [hasKey, setHasKey] = React.useState(false);

  const reload = React.useCallback(async () => {
    setEnabled((await getSetting(db, SETTING_KEYS_AI.aiFallbackEnabled)) === 'true');
    setHasKey((await getAnthropicKey()) !== null);
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const setAiEnabled = React.useCallback(
    async (on: boolean) => {
      await setSetting(db, SETTING_KEYS_AI.aiFallbackEnabled, on ? 'true' : 'false', 'manual');
      await reload();
    },
    [reload]
  );

  const saveKey = React.useCallback(
    async (key: string) => {
      // expo-secure-store only — never the settings table, never change_log.
      await setAnthropicKey(key);
      await reload();
    },
    [reload]
  );

  return { enabled, hasKey, setAiEnabled, saveKey };
}
