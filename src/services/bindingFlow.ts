/**
 * Orchestrated non-exact-binding flow (spec §6 v10) — one surface for
 * dominant index matches AND AI proposals:
 *
 *   miss → (AI proposes | index dominates) → propose → test-fetch →
 *   'awaiting-confirmation' → user confirms → bind + cache
 *
 * Every failure exit is 'unpriced' — never blocked, never silently
 * mis-tracking. Deps (proposer, test-fetch, AI toggle) are injected so
 * the gates are provable with mocks and the AI stays dormant without a
 * key or with the cloud toggle off.
 */
import type { Db } from '@/db/client';
import {
  applyConfirmation,
  applyTestFetch,
  propose,
  type BindingCandidate,
  type GateState,
} from '@/domain/symbols/bindingGate';
import type { Binding } from '@/domain/symbols/resolver';
import { SETTING_KEYS_AI } from './aiSettings';
import { getSetting } from '@/repositories/settings';

import { anthropicProposer, type Proposer } from './ai/proposer';
import { fetchCryptoPrice, fetchEquityPrice } from './providers';

export type TestFetch = (binding: Binding) => Promise<number | null>;

/** Live gate 1: does the providerId actually resolve to a price? */
export const liveTestFetch: TestFetch = async (binding) => {
  const point =
    binding.class === 'CRYPTO'
      ? await fetchCryptoPrice(binding.symbol, binding.providerId)
      : await fetchEquityPrice(binding.symbol, binding.providerId);
  return point?.priceMinor ?? null;
};

export interface BindingFlowDeps {
  proposer: Proposer;
  testFetch: TestFetch;
  /** Reflects the user's cloud toggle; AI never fires when false. */
  aiEnabled: (db: Db) => Promise<boolean>;
}

export const defaultDeps: BindingFlowDeps = {
  proposer: anthropicProposer,
  testFetch: liveTestFetch,
  aiEnabled: async (db) => (await getSetting(db, SETTING_KEYS_AI.aiFallbackEnabled)) === 'true',
};

export type FallbackOutcome =
  | { outcome: 'awaiting-confirmation'; gate: GateState & { state: 'verified' } }
  | { outcome: 'unpriced'; reason: string };

/**
 * Run a candidate (dominant or AI) through gate 0+1. The result is either
 * verified-awaiting-confirmation or unpriced — never bound: binding
 * happens only in confirmCandidate, after the human gate.
 */
export async function verifyCandidate(
  candidate: BindingCandidate,
  deps: BindingFlowDeps = defaultDeps
): Promise<FallbackOutcome> {
  const proposed = propose(candidate);
  if (proposed.state === 'rejected') {
    return { outcome: 'unpriced', reason: proposed.reason };
  }
  const fetched = applyTestFetch(proposed, await deps.testFetch(candidate.binding));
  if (fetched.state === 'rejected') {
    return { outcome: 'unpriced', reason: fetched.reason };
  }
  return { outcome: 'awaiting-confirmation', gate: fetched as GateState & { state: 'verified' } };
}

/**
 * Full miss path: ask the AI (only if enabled), then gate its proposal.
 */
export async function aiFallback(
  db: Db,
  query: string,
  cls: Binding['class'],
  deps: BindingFlowDeps = defaultDeps
): Promise<FallbackOutcome> {
  if (!(await deps.aiEnabled(db))) return { outcome: 'unpriced', reason: 'ai-disabled' };
  const candidate = await deps.proposer(query, cls);
  if (!candidate) return { outcome: 'unpriced', reason: 'no-proposal' };
  return verifyCandidate(candidate, deps);
}

/** Gate 2: the human said yes (or no). Returns the final gate state. */
export function confirmCandidate(
  gate: GateState & { state: 'verified' },
  accepted: boolean
): GateState {
  return applyConfirmation(gate, accepted);
}

// ---------- manual-entry preparation (one decision point for the UI) ----------

import type { ParsedTransaction } from '@/domain/ingestion/types';
import { resolveBinding } from '@/domain/symbols/resolver';
import { loadCacheLookup } from '@/repositories/symbolMappings';
import { makeCacheLookup } from './resolution';

type AssetHint = ParsedTransaction['asset'];
const MARKET = new Set(['EQUITY', 'CRYPTO', 'ETF']);

export interface PendingConfirmation {
  candidate: BindingCandidate;
  fetchedPriceMinor: number;
}

export type ManualPreparation =
  | { kind: 'ready'; hint: AssetHint }
  | { kind: 'confirm'; pending: PendingConfirmation }
  | { kind: 'unpriced'; hint: AssetHint; reason: string };

/**
 * Decide what a manual market hint needs before an asset may exist:
 * exact/cached → ready; dominant → gate 1 then a confirmation card;
 * full miss → AI fallback (if enabled) then the same card; every failure
 * → unpriced. The UI acts on the answer; it never resolves on its own.
 */
export async function prepareManualBinding(
  db: Db,
  hint: AssetHint,
  deps: BindingFlowDeps = defaultDeps
): Promise<ManualPreparation> {
  if (!MARKET.has(hint.class) || hint.providerId) return { kind: 'ready', hint };
  const key = hint.symbol?.trim() || hint.name?.trim();
  if (!key) return { kind: 'unpriced', hint, reason: 'no-key' };

  const cache = makeCacheLookup(await loadCacheLookup(db));
  const resolved = resolveBinding(key, hint.class as Binding['class'], cache);

  if (resolved && resolved.match !== 'dominant') {
    return {
      kind: 'ready',
      hint: {
        ...hint,
        name: resolved.binding.displayName,
        symbol: resolved.binding.symbol,
        providerId: resolved.binding.providerId,
        currency: resolved.binding.currency,
      },
    };
  }

  const outcome = resolved
    ? await verifyCandidate(
        { binding: resolved.binding, origin: 'index-dominant', forQuery: key },
        deps
      )
    : await aiFallback(db, key, hint.class as Binding['class'], deps);

  if (outcome.outcome === 'awaiting-confirmation') {
    return {
      kind: 'confirm',
      pending: {
        candidate: outcome.gate.candidate,
        fetchedPriceMinor: outcome.gate.fetchedPriceMinor,
      },
    };
  }
  return { kind: 'unpriced', hint, reason: outcome.reason };
}
