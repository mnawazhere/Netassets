import { describe, expect, it } from '@jest/globals';

import { applyConfirmation, applyTestFetch, propose, type BindingCandidate } from './bindingGate';

const aiCandidate = (confidence?: number): BindingCandidate => ({
  binding: {
    displayName: 'Micron Technology Inc.',
    symbol: 'MU',
    class: 'EQUITY',
    providerId: 'mu.us',
    currency: 'USD',
  },
  origin: 'ai',
  confidence,
  forQuery: 'Micron',
});

const dominantCandidate: BindingCandidate = {
  binding: {
    displayName: 'Microsoft Corporation',
    symbol: 'MSFT',
    class: 'EQUITY',
    providerId: 'msft.us',
    currency: 'USD',
  },
  origin: 'index-dominant',
  forQuery: 'Micro',
};

describe('binding gate — nothing binds without BOTH gates', () => {
  it('the happy path requires propose → test-fetch → confirm, in order', () => {
    const g1 = propose(aiCandidate(0.9));
    expect(g1.state).toBe('proposed');
    const g2 = applyTestFetch(g1, 41200);
    expect(g2.state).toBe('verified');
    const g3 = applyConfirmation(g2, true);
    expect(g3.state).toBe('bound');
  });

  it('a proposal that FAILS the test-fetch routes to rejected (manual-unpriced)', () => {
    const g = applyTestFetch(propose(aiCandidate(0.9)), null);
    expect(g).toMatchObject({ state: 'rejected', reason: 'test-fetch-failed' });
  });

  it('a passing test-fetch alone does NOT bind — confirmation still required', () => {
    const g = applyTestFetch(propose(aiCandidate(0.9)), 41200);
    expect(g.state).toBe('verified'); // not 'bound'
  });

  it('confirming before the test-fetch is structurally impossible', () => {
    const g = propose(aiCandidate(0.9));
    expect(() => applyConfirmation(g, true)).toThrow(/cannot be confirmed/);
  });

  it('test-fetching twice is a programming error, not a re-roll', () => {
    const verified = applyTestFetch(propose(aiCandidate(0.9)), 41200);
    expect(() => applyTestFetch(verified, 41200)).toThrow(/expected 'proposed'/);
  });

  it('user rejection after a valid fetch → rejected (right-symbol-wrong-entity)', () => {
    const g = applyConfirmation(applyTestFetch(propose(aiCandidate(0.9)), 41200), false);
    expect(g).toMatchObject({ state: 'rejected', reason: 'user-rejected' });
  });

  it('low-confidence AI is rejected at the door', () => {
    expect(propose(aiCandidate(0.3))).toMatchObject({ state: 'rejected', reason: 'low-confidence' });
    expect(propose(aiCandidate(undefined))).toMatchObject({ state: 'rejected', reason: 'low-confidence' });
  });

  it('dominant index matches ride the SAME gate as AI proposals', () => {
    const g1 = propose(dominantCandidate); // no confidence needed — curated
    expect(g1.state).toBe('proposed');
    const g2 = applyTestFetch(g1, 41200);
    const g3 = applyConfirmation(g2, true);
    expect(g3.state).toBe('bound');
    // And the same refusal to skip gates:
    expect(() => applyConfirmation(propose(dominantCandidate), true)).toThrow();
  });
});
