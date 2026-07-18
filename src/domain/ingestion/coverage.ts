/** Statement-coverage analysis (spec §6): every import stores its date
 *  range so the engine knows which periods are covered and can flag
 *  overlaps (dedup will be doing work) and gaps (missing months). */
import type { CoveredRange } from './types';

export interface CoverageReport {
  /** Existing windows (same account) the new one overlaps. */
  overlaps: CoveredRange[];
  /** Uncovered stretch between the new window and its nearest earlier one. */
  gapBefore: { from: string; to: string } | null;
}

export function analyzeCoverage(
  existing: CoveredRange[],
  incoming: CoveredRange
): CoverageReport {
  const sameAccount = existing.filter(
    (r) => (r.sourceAccount ?? null) === (incoming.sourceAccount ?? null)
  );

  const overlaps = sameAccount.filter(
    (r) =>
      r.periodStart.localeCompare(incoming.periodEnd) <= 0 &&
      r.periodEnd.localeCompare(incoming.periodStart) >= 0
  );

  const earlier = sameAccount
    .filter((r) => r.periodEnd.localeCompare(incoming.periodStart) < 0)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];

  let gapBefore: CoverageReport['gapBefore'] = null;
  if (earlier) {
    const dayAfter = nextDay(earlier.periodEnd);
    if (dayAfter.localeCompare(incoming.periodStart) < 0) {
      gapBefore = { from: dayAfter, to: prevDay(incoming.periodStart) };
    }
  }

  return { overlaps, gapBefore };
}

function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

const nextDay = (iso: string) => shiftDay(iso, 1);
const prevDay = (iso: string) => shiftDay(iso, -1);
