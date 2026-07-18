/** UUID v4. Uses the runtime's crypto when present (Node, modern Hermes),
 *  falling back to expo-crypto on native. */
export function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('expo-crypto') as { randomUUID: () => string };
  return randomUUID();
}

/** ISO UTC timestamp for created_at/updated_at columns. */
export function nowISO(): string {
  return new Date().toISOString();
}
