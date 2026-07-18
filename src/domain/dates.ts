/** Date math for the return engine. Pure — no I/O, no native deps. */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Normalize any incoming date to UTC midnight of its CALENDAR date.
 * Every date entering the return engine passes through here, so day math
 * can never drift by fractional days (DST, timezone-built Dates, parser
 * output with time components).
 *
 * - Strings must start with ISO `YYYY-MM-DD`; anything after is ignored.
 * - Date objects are read via their LOCAL calendar components — the date
 *   the user saw on the wall clock is the date we keep.
 */
export function normalizeUTC(input: Date | string): Date {
  if (typeof input === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.trim());
    if (!m) throw new Error(`Expected ISO date (YYYY-MM-DD…), got "${input}"`);
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  return new Date(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()));
}

/** Days between two dates (b − a), fractional. */
export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_PER_DAY;
}

/**
 * Year fraction between two dates on an Actual/365 basis — the convention
 * XIRR uses (Excel-compatible): (b − a) in days / 365.
 */
export function yearFraction(a: Date, b: Date): number {
  return daysBetween(a, b) / 365;
}
