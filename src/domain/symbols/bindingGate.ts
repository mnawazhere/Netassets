/**
 * The confirmation gate for NON-EXACT bindings (spec §6 v10): dominant
 * index matches and AI proposals are hypotheses, and a hypothesis binds
 * only after BOTH gates pass, in order:
 *
 *   proposed --testFetch ok--> verified --user confirms--> bound
 *       \--low confidence/fetch fail--> rejected (manual-unpriced)
 *                                verified --user rejects--> rejected
 *
 * The transitions are the only way to move state; skipping a gate is a
 * thrown error, not a policy choice. Pure — test-fetch results and
 * confirmations arrive as data.
 */
import type { Binding } from './resolver';

export interface BindingCandidate {
  binding: Binding;
  /** Who guessed: a unique fuzzy index match, or the model. */
  origin: 'index-dominant' | 'ai';
  /** AI self-reported confidence (0..1); index-dominant has none. */
  confidence?: number;
  /** The free text that triggered resolution — cached on confirm. */
  forQuery: string;
}

export type GateState =
  | { state: 'proposed'; candidate: BindingCandidate }
  | { state: 'verified'; candidate: BindingCandidate; fetchedPriceMinor: number }
  | { state: 'bound'; candidate: BindingCandidate; fetchedPriceMinor: number }
  | { state: 'rejected'; candidate: BindingCandidate; reason: RejectReason };

export type RejectReason =
  | 'low-confidence'
  | 'test-fetch-failed'
  | 'user-rejected';

export const MIN_AI_CONFIDENCE = 0.6;

/** Gate 0: admit a candidate at all. Low-confidence AI never even queues. */
export function propose(candidate: BindingCandidate): GateState {
  if (
    candidate.origin === 'ai' &&
    (candidate.confidence === undefined || candidate.confidence < MIN_AI_CONFIDENCE)
  ) {
    return { state: 'rejected', candidate, reason: 'low-confidence' };
  }
  return { state: 'proposed', candidate };
}

/** Gate 1: the live test-fetch — proves the providerId resolves to a price. */
export function applyTestFetch(
  gate: GateState,
  fetchedPriceMinor: number | null
): GateState {
  if (gate.state !== 'proposed') {
    throw new Error(`applyTestFetch: expected 'proposed', got '${gate.state}'`);
  }
  if (fetchedPriceMinor === null || fetchedPriceMinor <= 0) {
    return { state: 'rejected', candidate: gate.candidate, reason: 'test-fetch-failed' };
  }
  return { state: 'verified', candidate: gate.candidate, fetchedPriceMinor };
}

/** Gate 2: the human — proves it's the right ENTITY, not just a valid symbol. */
export function applyConfirmation(gate: GateState, accepted: boolean): GateState {
  if (gate.state !== 'verified') {
    throw new Error(
      `applyConfirmation: expected 'verified', got '${gate.state}' — a binding cannot be confirmed before its test-fetch passes`
    );
  }
  if (!accepted) {
    return { state: 'rejected', candidate: gate.candidate, reason: 'user-rejected' };
  }
  return { state: 'bound', candidate: gate.candidate, fetchedPriceMinor: gate.fetchedPriceMinor };
}
