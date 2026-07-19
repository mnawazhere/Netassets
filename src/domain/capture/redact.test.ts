import { describe, expect, it } from '@jest/globals';

import { redactForCloud } from './redact';

/** Spec §6 guardrail: minimize the payload, don't just rely on ZDR. The
 *  structurer needs date/ticker/qty/price/type/platform — identifiers must
 *  not survive redaction. */
describe('redactForCloud', () => {
  it('strips IBANs', () => {
    expect(redactForCloud('transfer from AE070331234567890123456 for the unit')).toBe(
      'transfer from [REDACTED] for the unit'
    );
  });

  it('strips long digit runs (account/card numbers) but keeps amounts and years', () => {
    const out = redactForCloud('acct 12345678901234 got 1600000 rent on 2026-07-19');
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('1600000');
    expect(out).toContain('2026-07-19');
  });

  it('strips emails and phone numbers', () => {
    const out = redactForCloud('mail mnawaz@example.com or +971 50 123 4567');
    expect(out).not.toContain('example.com');
    expect(out).not.toContain('123 4567');
  });

  it('keeps ordinary capture speech intact', () => {
    const s = 'bought 2 Pokemon boxes for 400 dirhams each, spent 5 hours';
    expect(redactForCloud(s)).toBe(s);
  });

  it('keeps prices with separators and tickers', () => {
    const s = 'MSFT at 425.30, total 1,000.50 USD on trading212';
    expect(redactForCloud(s)).toBe(s);
  });
});
