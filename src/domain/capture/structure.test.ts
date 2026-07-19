import { describe, expect, it } from '@jest/globals';

import { validateCaptureProposal } from './structure';

/** Model output is untrusted text — the validator is the only gate between
 *  a cloud response and the capture form. */
const good = {
  assetName: 'Pokémon 151 booster box',
  class: 'COLLECTIBLE',
  type: 'BUY',
  amount: '800',
  currency: 'AED',
  date: '2026-07-19',
  quantity: 2,
  hoursSpent: 5,
  account: null,
  confidence: 0.9,
};

describe('validateCaptureProposal', () => {
  it('passes a well-formed proposal through', () => {
    expect(validateCaptureProposal(good)).toEqual(good);
  });

  it('rejects unknown class or type instead of coercing', () => {
    expect(validateCaptureProposal({ ...good, class: 'NFT' })).toBeNull();
    expect(validateCaptureProposal({ ...good, type: 'SHORT' })).toBeNull();
  });

  it('rejects malformed dates and non-numeric amounts', () => {
    expect(validateCaptureProposal({ ...good, date: 'yesterday' })).toBeNull();
    expect(validateCaptureProposal({ ...good, amount: 'eight hundred' })).toBeNull();
  });

  it('rejects negative or absurd quantity/hours', () => {
    expect(validateCaptureProposal({ ...good, quantity: -2 })).toBeNull();
    expect(validateCaptureProposal({ ...good, hoursSpent: 10000 })).toBeNull();
  });

  it('normalizes currency to uppercase 3-letter, rejects junk', () => {
    expect(validateCaptureProposal({ ...good, currency: 'aed' })?.currency).toBe('AED');
    expect(validateCaptureProposal({ ...good, currency: 'dirhams' })).toBeNull();
  });

  it('nulls optional fields cleanly and rejects on missing required ones', () => {
    const min = { ...good, quantity: null, hoursSpent: null, account: null };
    expect(validateCaptureProposal(min)).toEqual(min);
    expect(validateCaptureProposal({ ...good, amount: undefined })).toBeNull();
    expect(validateCaptureProposal(null)).toBeNull();
    expect(validateCaptureProposal('{}')).toBeNull();
  });

  it('clamps confidence into [0,1]', () => {
    expect(validateCaptureProposal({ ...good, confidence: 7 })?.confidence).toBe(1);
    expect(validateCaptureProposal({ ...good, confidence: -1 })?.confidence).toBe(0);
  });
});
