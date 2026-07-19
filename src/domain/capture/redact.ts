/**
 * On-device redaction before ANY text leaves the phone (spec §6 guardrail:
 * minimize the payload, don't just rely on ZDR). The structurer only needs
 * date / ticker / quantity / price / type / platform — account numbers,
 * IBANs, emails, and phone numbers must not survive.
 *
 * Order matters: IBAN before generic digit runs (an IBAN contains one).
 */

const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
/** + or 00 international prefix, then 8+ digits with optional separators. */
const PHONE = /(?:\+|00)\d[\d\s().-]{7,}\d/g;
/** 9+ consecutive digits: card/account territory. Amounts (≤8 digits — up
 *  to tens of millions in minor units), years, and ISO dates survive. */
const LONG_DIGITS = /\d{9,}/g;

export function redactForCloud(text: string): string {
  return text
    .replace(IBAN, '[REDACTED]')
    .replace(EMAIL, '[REDACTED]')
    .replace(PHONE, '[REDACTED]')
    .replace(LONG_DIGITS, '[REDACTED]');
}
