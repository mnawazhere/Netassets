/**
 * Quantity derivation for assume-at-market capture: the user gives an amount
 * and a date; we divide by that date's unit price to PRE-FILL the qty field.
 * Always editable — an estimate, never silently authoritative.
 */

/** amount ÷ unit price, both in minor units of the SAME currency. Positive,
 *  6-dp rounded (fractional shares); null when either side is unusable. */
export function deriveQuantity(amountMinor: number, priceMinor: number): number | null {
  if (!Number.isFinite(amountMinor) || !Number.isFinite(priceMinor)) return null;
  if (amountMinor === 0 || priceMinor <= 0) return null;
  return Math.round((Math.abs(amountMinor) / priceMinor) * 1e6) / 1e6;
}
