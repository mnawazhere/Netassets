/**
 * AI binding proposer (spec §6): fires ONLY on an index/cache miss, never
 * per keystroke, and only when the cloud toggle is on and a key exists.
 * Output is a CANDIDATE — schema-validated here, then gated (test-fetch +
 * user confirmation) before it can bind. Never throws; null = no proposal.
 *
 * Model: claude-haiku-4-5 (§11 routing — high-volume trivial mapping).
 */
import type { BindingCandidate } from '@/domain/symbols/bindingGate';
import type { Binding } from '@/domain/symbols/resolver';

import { getAnthropicKey } from '../secureKeys';

const MODEL = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 15_000;

const PROMPT = (query: string, cls: Binding['class']) =>
  `Map this ${cls === 'CRYPTO' ? 'cryptocurrency' : 'US-listed security'} name or ticker to its canonical identity: "${query}".

Reply with ONLY a JSON object, no prose:
{"displayName": "...", "symbol": "...", "providerId": "...", "confidence": 0.0-1.0}

providerId rules:
- EQUITY/ETF: the Stooq id — lowercase ticker + ".us" (Microsoft → "msft.us"; dots become dashes: BRK.B → "brk-b.us")
- CRYPTO: the CoinGecko coin id (Bitcoin → "bitcoin", not "btc")
confidence: your honest probability this is the entity the user meant.
If you cannot identify it, reply {"confidence": 0}.`;

export type Proposer = (query: string, cls: Binding['class']) => Promise<BindingCandidate | null>;

/** Strict shape validation — model output is untrusted text. */
export function validateProposal(
  raw: unknown,
  query: string,
  cls: Binding['class']
): BindingCandidate | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const confidence = typeof o.confidence === 'number' ? o.confidence : 0;
  if (
    typeof o.displayName !== 'string' ||
    typeof o.symbol !== 'string' ||
    typeof o.providerId !== 'string' ||
    o.displayName.trim() === '' ||
    o.symbol.trim() === '' ||
    o.providerId.trim() === ''
  ) {
    return null;
  }
  const providerId = o.providerId.trim();
  const providerIdOk =
    cls === 'CRYPTO' ? /^[a-z0-9-]+$/.test(providerId) : /^[a-z0-9-]+\.us$/.test(providerId);
  if (!providerIdOk) return null;
  return {
    binding: {
      displayName: o.displayName.trim(),
      symbol: o.symbol.trim().toUpperCase(),
      class: cls,
      providerId,
      currency: 'USD',
    },
    origin: 'ai',
    confidence,
    forQuery: query,
  };
}

export const anthropicProposer: Proposer = async (query, cls) => {
  const key = await getAnthropicKey();
  if (!key) return null;
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
        messages: [{ role: 'user', content: PROMPT(query, cls) }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((b) => b.type === 'text')?.text ?? '';
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch) return null;
    return validateProposal(JSON.parse(jsonMatch[0]), query, cls);
  } catch {
    return null;
  }
};
