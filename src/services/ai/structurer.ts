/**
 * Capture structurer (spec §6/§11): REDACTED transcript or OCR text →
 * CaptureProposal. Cloud egress is the redacted text only — audio and
 * images never reach this module. Fires only when the AI toggle is on and
 * a key exists (caller checks the toggle; key check is here). Never
 * throws; null = no proposal, the user falls back to manual entry.
 *
 * Model: claude-sonnet-5 (§11 routing — transcript → structured
 * transaction; the trivial-row Haiku downgrade can come later).
 */
import { redactForCloud } from '@/domain/capture/redact';
import {
  validateCaptureProposal,
  validateSpendExtract,
  type CaptureProposal,
  type SpendExtract,
} from '@/domain/capture/structure';

import { getAnthropicKey } from '../secureKeys';

const MODEL = 'claude-sonnet-5';
const TIMEOUT_MS = 20_000;

const PROMPT = (text: string, source: 'voice' | 'ocr', today: string) =>
  `You structure personal-finance capture notes into one transaction. Today is ${today}.
Source: ${source === 'voice' ? 'a voice-note transcript' : 'OCR text from a screenshot'}.

Text:
"""
${text}
"""

Reply with ONLY a JSON object, no prose:
{"assetName": "...", "class": "EQUITY|CRYPTO|ETF|PROPERTY|COLLECTIBLE",
 "type": "BUY|SELL|DIVIDEND|RENT|FEE|MAINTENANCE|TRANSFER|VALUATION_MARK",
 "amount": "decimal string, TOTAL in the stated currency (unit price × count when both appear)",
 "currency": "3-letter code (dirhams→AED)", "date": "YYYY-MM-DD (resolve relative dates from today)",
 "quantity": number|null, "hoursSpent": number|null, "account": "platform/broker or null",
 "confidence": 0.0-1.0}

Rules:
- A statement of current worth ("X is worth Y now") is VALUATION_MARK, amount = Y.
- Never invent a field the text doesn't support — use null and lower confidence.
- If the text is not about an asset transaction at all, reply {"confidence": 0}.`;

export async function structureCapture(
  text: string,
  source: 'voice' | 'ocr',
  today: string
): Promise<CaptureProposal | null> {
  const key = await getAnthropicKey();
  if (!key) return null;
  const redacted = redactForCloud(text).trim();
  if (redacted === '') return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: PROMPT(redacted, source, today) }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const textOut = body.content?.find((b) => b.type === 'text')?.text ?? '';
    const jsonMatch = /\{[\s\S]*\}/.exec(textOut);
    if (!jsonMatch) return null;
    return validateCaptureProposal(JSON.parse(jsonMatch[0]));
  } catch {
    return null;
  }
}

const SPEND_PROMPT = (text: string, today: string) =>
  `You read OCR text from a credit-card or bank statement. Today is ${today}.

Text:
"""
${text}
"""

Reply with ONLY a JSON object, no prose:
{"month": "YYYY-MM the statement period covers",
 "total": "decimal string — the TOTAL spend/purchases for the period (not the minimum payment, not the credit limit)",
 "currency": "3-letter code", "confidence": 0.0-1.0}

If the text is not a statement or the total is not identifiable, reply {"confidence": 0}.`;

/** Card-statement screenshot → month + total spend (§14 actuals). Same
 *  privacy contract: redacted OCR text only; never throws; null = no read. */
export async function structureSpendStatement(
  text: string,
  today: string
): Promise<SpendExtract | null> {
  const key = await getAnthropicKey();
  if (!key) return null;
  const redacted = redactForCloud(text).trim();
  if (redacted === '') return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: SPEND_PROMPT(redacted, today) }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const textOut = body.content?.find((b) => b.type === 'text')?.text ?? '';
    const jsonMatch = /\{[\s\S]*\}/.exec(textOut);
    if (!jsonMatch) return null;
    return validateSpendExtract(JSON.parse(jsonMatch[0]));
  } catch {
    return null;
  }
}
