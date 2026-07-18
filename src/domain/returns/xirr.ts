/**
 * XIRR — money-weighted annualized return over an irregularly-dated
 * cashflow stream (Actual/365, Excel-compatible).
 *
 * Newton–Raphson from a starting guess, falling back to bisection over an
 * expanding bracket when Newton diverges or leaves the domain. Returns
 * null when no rate can explain the stream (all flows one-signed, fewer
 * than two nonzero flows, or no sign change of NPV in (−100%, 1000%]).
 */
import { yearFraction } from '../dates';

export interface DatedFlow {
  date: Date;
  amountMinor: number;
}

const MAX_NEWTON_ITER = 50;
const MAX_BISECT_ITER = 200;
const TOLERANCE = 1e-10;
const RATE_FLOOR = -0.999999; // rates ≤ −100% are not meaningful
const RATE_CEILING = 10; // 1000%/yr — beyond this, report no solution

interface PreparedFlow {
  t: number; // years since first flow
  amount: number;
}

function prepare(flows: DatedFlow[]): PreparedFlow[] | null {
  const nonZero = flows.filter((f) => f.amountMinor !== 0);
  if (nonZero.length < 2) return null;
  const hasPositive = nonZero.some((f) => f.amountMinor > 0);
  const hasNegative = nonZero.some((f) => f.amountMinor < 0);
  if (!hasPositive || !hasNegative) return null;

  const t0 = nonZero.reduce((min, f) => (f.date < min ? f.date : min), nonZero[0].date);
  return nonZero.map((f) => ({ t: yearFraction(t0, f.date), amount: f.amountMinor }));
}

function npv(flows: PreparedFlow[], rate: number): number {
  let sum = 0;
  for (const f of flows) {
    sum += f.amount / Math.pow(1 + rate, f.t);
  }
  return sum;
}

function npvDerivative(flows: PreparedFlow[], rate: number): number {
  let sum = 0;
  for (const f of flows) {
    sum += (-f.t * f.amount) / Math.pow(1 + rate, f.t + 1);
  }
  return sum;
}

function newton(flows: PreparedFlow[], guess: number): number | null {
  let rate = guess;
  for (let i = 0; i < MAX_NEWTON_ITER; i++) {
    const value = npv(flows, rate);
    if (Math.abs(value) < TOLERANCE) return rate;
    const derivative = npvDerivative(flows, rate);
    if (derivative === 0 || !Number.isFinite(derivative)) return null;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= RATE_FLOOR || next > RATE_CEILING) return null;
    if (Math.abs(next - rate) < TOLERANCE) return next;
    rate = next;
  }
  return null;
}

function bisect(flows: PreparedFlow[]): number | null {
  // Find a sign change of NPV over (RATE_FLOOR, RATE_CEILING].
  let lo = RATE_FLOOR;
  let hi: number | null = null;
  let npvLo = npv(flows, lo);
  const STEPS = 400;
  for (let i = 1; i <= STEPS; i++) {
    const r = RATE_FLOOR + ((RATE_CEILING - RATE_FLOOR) * i) / STEPS;
    const v = npv(flows, r);
    if (npvLo === 0) return lo;
    if (Math.sign(v) !== Math.sign(npvLo)) {
      hi = r;
      break;
    }
    lo = r;
    npvLo = v;
  }
  if (hi === null) return null;
  let high: number = hi;

  for (let i = 0; i < MAX_BISECT_ITER; i++) {
    const mid = (lo + high) / 2;
    const v = npv(flows, mid);
    if (Math.abs(v) < TOLERANCE || (high - lo) / 2 < TOLERANCE) return mid;
    if (Math.sign(v) === Math.sign(npvLo)) {
      lo = mid;
      npvLo = v;
    } else {
      high = mid;
    }
  }
  return (lo + high) / 2;
}

export function xirr(flows: DatedFlow[], guess = 0.1): number | null {
  const prepared = prepare(flows);
  if (prepared === null) return null;

  // Degenerate-but-answerable case: NPV at 0% is exactly 0 → the money
  // simply came back; the rate is 0 (also covers same-day equal in/out,
  // where every rate is a root — 0 is the only non-arbitrary answer).
  if (Math.abs(npv(prepared, 0)) < TOLERANCE) return 0;

  return newton(prepared, guess) ?? bisect(prepared);
}
