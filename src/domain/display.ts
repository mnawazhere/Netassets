/**
 * §5 display rules (v9, learned from device testing). List rows carry the
 * simple total MONEY return only — this module is the single source the UI
 * reads for rows, and it structurally has no per-hour and no labor-blended
 * figure to leak.
 */
import type { ReturnBreakdown } from './returns/engine';

export interface ListRowMetrics {
  /** Simple total money return, labor out, NOT annualized. Null = no basis. */
  moneyReturnFraction: number | null;
  stale: boolean;
}

export function listRowMetrics(
  breakdown: Pick<ReturnBreakdown, 'moneyReturnFraction'> | null,
  stale: boolean
): ListRowMetrics {
  return { moneyReturnFraction: breakdown?.moneyReturnFraction ?? null, stale };
}

/**
 * Per-hour belongs on asset detail ONLY, and even there it's suppressed
 * when hours are trivially small — dividing by ~0.1 hrs prices a tap of a
 * button like a wage.
 */
export const TRIVIAL_HOURS_THRESHOLD = 1;

export function shouldShowPerHour(totalHours: number): boolean {
  return totalHours >= TRIVIAL_HOURS_THRESHOLD;
}
