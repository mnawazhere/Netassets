/**
 * Money is ALWAYS stored and computed as an integer in the currency's
 * smallest unit ("minor units": fils, cents, yen), with the decimal scale
 * looked up per currency. JS floats never touch stored amounts.
 *
 * AED/USD have 2 decimals; JPY has 0 — a blanket "×100" would corrupt
 * JPY amounts. All rounding is centralized here (banker's rounding).
 */

/** ISO 4217 minor-unit exponents for currencies this app supports. */
const CURRENCY_DECIMALS: Record<string, number> = {
  AED: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  SAR: 2,
  CHF: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

export function isSupportedCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCY_DECIMALS, code.toUpperCase());
}

export function decimalsFor(currency: string): number {
  const d = CURRENCY_DECIMALS[currency.toUpperCase()];
  if (d === undefined) {
    throw new Error(`Unknown currency "${currency}" — add it to CURRENCY_DECIMALS`);
  }
  return d;
}

/**
 * Round to the nearest integer, ties to even (banker's rounding), so that
 * repeated conversions don't drift in one direction. Tolerates float noise
 * around the .5 boundary.
 */
export function roundHalfEven(x: number): number {
  const EPS = 1e-9;
  const floor = Math.floor(x);
  const diff = x - floor;
  if (Math.abs(diff - 0.5) < EPS) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(x);
}

/**
 * Parse a decimal amount into integer minor units.
 *
 * Strings are parsed exactly ("1234.56" → 123456) and REJECTED if they have
 * more decimals than the currency allows — capture paths should hand us
 * strings. Numbers are accepted for computed values and rounded half-even
 * at the currency's scale.
 */
export function toMinor(amount: string | number, currency: string): number {
  const decimals = decimalsFor(currency);

  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) throw new Error(`Non-finite amount: ${amount}`);
    return roundHalfEven(amount * 10 ** decimals);
  }

  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim().replace(/,/g, ''));
  if (!m) throw new Error(`Unparseable amount "${amount}"`);
  const [, sign, whole, frac = ''] = m;
  if (frac.length > decimals) {
    throw new Error(
      `"${amount}" has ${frac.length} decimals but ${currency.toUpperCase()} allows ${decimals}`
    );
  }
  const minor = Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of safe range: "${amount}"`);
  return sign === '-' ? -minor : minor;
}

/** Minor units → decimal number (display/aggregation only — never store this). */
export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** decimalsFor(currency);
}

/** "AED 1,234.56" / "JPY 45,000" — always the currency's exact scale. */
export function formatMinor(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  const decimals = decimalsFor(code);
  const value = fromMinor(minor, code);
  return `${code} ${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Convert minor units between currencies at a given rate (1 `from` = `rate`
 * `to`), rounding half-even at the target currency's scale.
 */
export function convertMinor(
  minor: number,
  from: string,
  to: string,
  rate: number
): number {
  const major = fromMinor(minor, from) * rate;
  return toMinor(major, to);
}
