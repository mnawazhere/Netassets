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
import type { AssetClass, LiabilityKind, TransactionType } from '@/db/schema';
import { normalizeAccount } from '@/domain/position';
import { parseEtoroCsv } from '@/domain/ingestion/etoro';
import { convertMinor, fromMinor, toMinor } from '@/domain/money';
import { todayISO } from '@/lib/format';
import { changesFor } from '@/repositories/changeLog';
import { getAsset, listAssets, valuationMarksFor } from '@/repositories/assets';
import {
  createLiability,
  deleteLiability,
  listLiabilities,
  updateOutstanding,
} from '@/repositories/liabilities';
import { SETTING_KEYS_AI } from '@/services/aiSettings';
import { prepareManualBinding, type PendingConfirmation } from '@/services/bindingFlow';
import { assumeQuantity } from '@/services/assumeQty';
import { computeIncomeView, computeNavHistory, type IncomeResult, type NavHistoryResult } from '@/services/history';
import { primePrice, refreshPriceFor } from '@/services/pricing';
import { fetchFxRate } from '@/services/providers';
import { ensureAsset } from '@/services/resolution';
import { getAnthropicKey, setAnthropicKey } from '@/services/secureKeys';
import { pendingReviews, resolveReview } from '@/repositories/reviewQueue';
import { SETTING_KEYS, getSetting, setSetting } from '@/repositories/settings';
import { insertTransaction, insertValuationMark } from '@/repositories/transactions';
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
    let cancelled = false;
    void computePortfolioView(db, todayISO()).then((v) => {
      if (cancelled) return;
      setView(v);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { view, loading, reload, refresh };
}

// ---------- asset detail ----------

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
  /** priced: true = fetched/primed now; false = fetch FAILED (network or
   *  provider) — surfaced so a reachability problem is visible at save
   *  time, not a mystery dash later; undefined = not a pricing situation.
   *  assumedQty: set when a qty-less market BUY/SELL had its quantity
   *  derived automatically at the transaction date's market price. */
  | { ok: true; priced?: boolean; assumedQty?: { quantity: number; priceAsOf: string } }
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
    let priced: boolean | undefined;
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
          priced = true;
        } else {
          // offline/provider-down → false; surfaced in the save alert.
          priced = await refreshPriceFor(db, {
            class: hint.class,
            symbol: hint.symbol,
            providerId: hint.providerId,
          });
        }
      }
    }
    // A VALUATION_MARK is a statement of current worth, not a cashflow —
    // it writes to the marks table that drives mark-valued (property/
    // collectible) pricing, and never enters the transaction stream.
    if (entry.type === 'VALUATION_MARK') {
      await insertValuationMark(db, {
        assetId,
        date: entry.date,
        valueMinor: Math.abs(toMinor(entry.amount, entry.currency)),
        currency: entry.currency.toUpperCase(),
        source: 'manual',
        note: entry.note,
      });
      return { ok: true };
    }

    // Auto-assume: a qty-less market BUY/SELL would value the position at
    // ZERO (a fabricated −100% loss). Derive qty = amount ÷ market price on
    // the transaction date; the user can edit the transaction's qty later.
    // Failure to price leaves qty null — the valuation layer then surfaces
    // the asset as unvalued instead of zero-valued.
    let quantity = entry.quantity;
    let assumedQty: { quantity: number; priceAsOf: string } | undefined;
    if (quantity === null && (entry.type === 'BUY' || entry.type === 'SELL')) {
      const assetRow = await getAsset(db, assetId);
      if (
        assetRow?.symbol &&
        (assetRow.class === 'EQUITY' || assetRow.class === 'ETF' || assetRow.class === 'CRYPTO')
      ) {
        const est = await assumeQuantity({
          symbol: assetRow.symbol,
          class: assetRow.class,
          amountMajor: entry.amount,
          amountCurrency: entry.currency,
          date: entry.date,
        });
        if (est) {
          quantity = est.quantity;
          assumedQty = { quantity: est.quantity, priceAsOf: est.priceAsOf };
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
        quantity,
        hoursSpent: entry.hoursSpent,
        sourceAccount: normalizeAccount(entry.sourceAccount),
        sourceTxnId: null,
        sourceRef: null,
        note: entry.note,
      },
      'manual'
    );
    return { ok: true, priced, assumedQty };
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
    { id: string; reason: string; payload: string; createdAt: string }[]
  >([]);

  const reload = React.useCallback(async () => {
    setItems(await pendingReviews(db));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void pendingReviews(db).then((rows) => {
      if (!cancelled) setItems(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

/** Currency the stored hourly rate is denominated in — MUST track the base
 *  currency, because the return engine reads hourly_rate_minor as base minor
 *  units (baseCurrency.ts: "already in base currency"). */
async function hourlyRateCurrency(): Promise<string> {
  return (
    (await getSetting(db, SETTING_KEYS.hourlyRateCurrency)) ??
    (await getSetting(db, SETTING_KEYS.baseCurrency)) ??
    'AED'
  ).toUpperCase();
}

async function loadSettingsData() {
  const rate = await getSetting(db, SETTING_KEYS.hourlyRateMinor);
  const rateCurrency = await hourlyRateCurrency();
  const defaults: Record<string, string> = {};
  for (const cls of Object.keys(CLASS_HOURS_DEFAULTS) as AssetClass[]) {
    defaults[cls] = String(await classHoursDefault(cls));
  }
  return {
    // Scale by the rate's own currency — a blanket /100 corrupts JPY/KWD.
    hourlyRate: rate !== null ? String(fromMinor(Number(rate), rateCurrency)) : '',
    baseCurrency: (await getSetting(db, SETTING_KEYS.baseCurrency)) ?? 'AED',
    timeDefaults: defaults,
    audit: (await changesFor(db, 'settings', SETTING_KEYS.hourlyRateMinor)).slice(0, 10),
  };
}

export function useSettingsData() {
  const [hourlyRate, setHourlyRateState] = React.useState<string>('');
  const [baseCurrency, setBaseCurrencyState] = React.useState<string>('AED');
  const [timeDefaults, setTimeDefaults] = React.useState<Record<string, string>>({});
  const [audit, setAudit] = React.useState<
    { entity: string; field: string; oldValue: string | null; newValue: string | null; timestamp: string; source: string }[]
  >([]);

  const reload = React.useCallback(async () => {
    const s = await loadSettingsData();
    setHourlyRateState(s.hourlyRate);
    setBaseCurrencyState(s.baseCurrency);
    setTimeDefaults(s.timeDefaults);
    setAudit(s.audit);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void loadSettingsData().then((s) => {
      if (cancelled) return;
      setHourlyRateState(s.hourlyRate);
      setBaseCurrencyState(s.baseCurrency);
      setTimeDefaults(s.timeDefaults);
      setAudit(s.audit);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveHourlyRate = React.useCallback(
    async (ratePerHour: string) => {
      // Stored in BASE-currency minor units at the base currency's scale.
      const base = ((await getSetting(db, SETTING_KEYS.baseCurrency)) ?? 'AED').toUpperCase();
      await setSetting(db, SETTING_KEYS.hourlyRateMinor, String(toMinor(ratePerHour, base)), 'manual');
      await setSetting(db, SETTING_KEYS.hourlyRateCurrency, base, 'manual');
      await reload();
    },
    [reload]
  );

  const saveBaseCurrency = React.useCallback(
    async (code: string) => {
      const next = code.toUpperCase();
      // Re-denominate the stored hourly rate into the new base so labor
      // keeps its worth (and, at minimum, the new currency's minor scale).
      const stored = await getSetting(db, SETTING_KEYS.hourlyRateMinor);
      const rateCurrency = await hourlyRateCurrency();
      if (stored !== null && rateCurrency !== next) {
        const fx = await fetchFxRate(rateCurrency, next);
        const minor = fx
          ? convertMinor(Number(stored), rateCurrency, next, fx.rate)
          : // Offline fallback: keep the displayed number, fix the scale — a
            // visible-and-editable rate beats a silent 100x scale corruption.
            toMinor(fromMinor(Number(stored), rateCurrency), next);
        await setSetting(db, SETTING_KEYS.hourlyRateMinor, String(minor), 'system');
        await setSetting(db, SETTING_KEYS.hourlyRateCurrency, next, 'system');
      }
      await setSetting(db, SETTING_KEYS.baseCurrency, next, 'manual');
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

// ---------- tier 2: NAV history + income ----------

export function useNavHistory(): { history: NavHistoryResult | null; reload: () => Promise<void> } {
  const [history, setHistory] = React.useState<NavHistoryResult | null>(null);

  const reload = React.useCallback(async () => {
    setHistory(await computeNavHistory(db, todayISO()));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void computeNavHistory(db, todayISO()).then((h) => {
      if (cancelled) return;
      setHistory(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { history, reload };
}

export function useIncome(): { income: IncomeResult | null; reload: () => Promise<void> } {
  const [income, setIncome] = React.useState<IncomeResult | null>(null);

  const reload = React.useCallback(async () => {
    setIncome(await computeIncomeView(db, todayISO()));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void computeIncomeView(db, todayISO()).then((v) => {
      if (cancelled) return;
      setIncome(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { income, reload };
}

// ---------- liabilities (NAV = assets − liabilities) ----------

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

export function useLiabilities() {
  const [liabilities, setLiabilities] = React.useState<LiabilityRow[]>([]);

  const reload = React.useCallback(async () => {
    setLiabilities(await listLiabilities(db));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void listLiabilities(db).then((rows) => {
      if (cancelled) return;
      setLiabilities(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Record a newly confirmed balance, dated today (device clock, date-only). */
  const saveOutstanding = React.useCallback(
    async (id: string, amount: string, currency: string) => {
      await updateOutstanding(db, id, toMinor(amount, currency), todayISO());
      await reload();
    },
    [reload]
  );

  const addLiability = React.useCallback(
    async (name: string, kind: string, amount: string, currency: string, assetId: string | null) => {
      await createLiability(db, {
        name,
        kind: kind as LiabilityKind,
        assetId,
        currency,
        outstandingMinor: toMinor(amount, currency),
        asOf: todayISO(),
        note: null,
      });
      await reload();
    },
    [reload]
  );

  const removeLiability = React.useCallback(
    async (id: string) => {
      await deleteLiability(db, id);
      await reload();
    },
    [reload]
  );

  return { liabilities, reload, saveOutstanding, addLiability, removeLiability };
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
    let cancelled = false;
    void Promise.all([getSetting(db, SETTING_KEYS_AI.aiFallbackEnabled), getAnthropicKey()]).then(
      ([enabledSetting, key]) => {
        if (cancelled) return;
        setEnabled(enabledSetting === 'true');
        setHasKey(key !== null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

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
