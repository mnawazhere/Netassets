/** Date math for the return engine. Pure — no I/O, no native deps. */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
