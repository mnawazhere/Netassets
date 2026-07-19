/**
 * Capture structuring proposal — the shape a cloud structurer must produce
 * from a (redacted) transcript or OCR text, and the strict validator that
 * is the ONLY gate between untrusted model output and the capture form.
 * A proposal PRE-FILLS the form; the user always reviews before saving.
 */
import { ASSET_CLASSES, TRANSACTION_TYPES } from '@/db/schema';

export interface CaptureProposal {
  assetName: string;
  class: (typeof ASSET_CLASSES)[number];
  type: (typeof TRANSACTION_TYPES)[number];
  /** Major units as a decimal string — the form owns minor-unit scaling. */
  amount: string;
  currency: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  quantity: number | null;
  hoursSpent: number | null;
  account: string | null;
  confidence: number;
}

const CLASSES = new Set<string>(ASSET_CLASSES);
const TYPES = new Set<string>(TRANSACTION_TYPES);

export function validateCaptureProposal(raw: unknown): CaptureProposal | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;

  if (typeof o.assetName !== 'string' || o.assetName.trim() === '') return null;
  if (typeof o.class !== 'string' || !CLASSES.has(o.class)) return null;
  if (typeof o.type !== 'string' || !TYPES.has(o.type)) return null;

  const amount = typeof o.amount === 'string' ? o.amount.trim() : String(o.amount ?? '');
  if (!/^-?\d+(\.\d+)?$/.test(amount)) return null;

  const currency =
    typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency.trim())
      ? o.currency.trim().toUpperCase()
      : null;
  if (!currency) return null;

  if (typeof o.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return null;

  const num = (v: unknown, max: number): number | null | false => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return false;
    return v;
  };
  const quantity = num(o.quantity, 1_000_000);
  const hoursSpent = num(o.hoursSpent, 1000);
  if (quantity === false || hoursSpent === false) return null;

  const account =
    typeof o.account === 'string' && o.account.trim() !== '' ? o.account.trim() : null;

  const confidence =
    typeof o.confidence === 'number' && Number.isFinite(o.confidence)
      ? Math.min(1, Math.max(0, o.confidence))
      : 0;

  return {
    assetName: o.assetName.trim(),
    class: o.class as CaptureProposal['class'],
    type: o.type as CaptureProposal['type'],
    amount,
    currency,
    date: o.date,
    quantity,
    hoursSpent,
    account,
    confidence,
  };
}

/** Card-statement extraction (§14 actuals): the month and TOTAL spend a
 *  statement screenshot's OCR text describes. Same untrusted-output rules. */
export interface SpendExtract {
  /** 'YYYY-MM' the statement covers. */
  month: string;
  /** Total spend, major units decimal string, positive. */
  total: string;
  currency: string;
  confidence: number;
}

export function validateSpendExtract(raw: unknown): SpendExtract | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  if (typeof o.month !== 'string' || !/^\d{4}-\d{2}$/.test(o.month)) return null;
  const total = typeof o.total === 'string' ? o.total.trim() : String(o.total ?? '');
  if (!/^\d+(\.\d+)?$/.test(total)) return null;
  const currency =
    typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency.trim())
      ? o.currency.trim().toUpperCase()
      : null;
  if (!currency) return null;
  const confidence =
    typeof o.confidence === 'number' && Number.isFinite(o.confidence)
      ? Math.min(1, Math.max(0, o.confidence))
      : 0;
  return { month: o.month, total, currency, confidence };
}
