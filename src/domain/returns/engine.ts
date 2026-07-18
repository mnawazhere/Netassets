/**
 * Return + cost-of-time engine (spec §5, corrected v2/v3).
 *
 * Three DISTINCT headline metrics — never merged:
 *   true_profit     = gross_gain − monetary_costs − labor_cost   (currency)
 *   XIRR            = money-weighted annualized %, fees IN, labor OUT
 *   return_per_hour = (gross_gain − monetary_costs) / Σhours
 *                     labor NOT subtracted here — dividing an
 *                     already-labor-netted figure by hours double-counts.
 *
 * All amounts are integer minor units in ONE currency (convert before
 * calling — see convertTransactions). Pure: no I/O, no db.
 */
import { normalizeUTC } from '../dates';
import { convertMinor, roundHalfEven } from '../money';
import { xirr, type DatedFlow } from './xirr';

/** Storage-agnostic transaction view the engine consumes. */
export interface CashTxn {
  type: string; // TransactionType; string-typed so domain stays db-free
  date: string; // ISO YYYY-MM-DD
  amountMinor: number; // signed: buys/fees −, sells/income +
  hoursSpent: number;
}

export interface AssetReturnInput {
  transactions: CashTxn[];
  /** Adapter's current value; 0 for a fully-sold asset. */
  currentValueMinor: number;
  /** Valuation date of currentValueMinor. */
  asOf: string;
  hourlyRateMinor: number;
}

export interface ReturnBreakdown {
  costBasisMinor: number;
  realizedProceedsMinor: number;
  incomeMinor: number;
  /** Positive magnitude of FEE/MAINTENANCE money. */
  monetaryCostsMinor: number;
  grossGainMinor: number;
  totalHours: number;
  laborCostMinor: number;
  trueProfitMinor: number;
  /** Minor units per hour, labor not subtracted; null when no hours logged. */
  returnPerHourMinor: number | null;
  /** Annualized money-weighted return; null when the stream has no solution. */
  xirr: number | null;
}

const COST_BASIS_TYPES = new Set(['BUY']);
const REALIZED_TYPES = new Set(['SELL']);
const INCOME_TYPES = new Set(['DIVIDEND', 'RENT']);
const MONEY_COST_TYPES = new Set(['FEE', 'MAINTENANCE']);

/** Types that carry real cash in/out and belong in the XIRR stream. */
const CASHFLOW_TYPES = new Set([
  ...COST_BASIS_TYPES,
  ...REALIZED_TYPES,
  ...INCOME_TYPES,
  ...MONEY_COST_TYPES,
]);

export function computeAssetReturn(input: AssetReturnInput): ReturnBreakdown {
  let costBasis = 0;
  let realized = 0;
  let income = 0;
  let moneyCosts = 0;
  let hours = 0;
  const flows: DatedFlow[] = [];

  for (const t of input.transactions) {
    if (!CASHFLOW_TYPES.has(t.type)) continue; // TRANSFER, VALUATION_MARK: not cash
    if (COST_BASIS_TYPES.has(t.type)) costBasis += Math.abs(t.amountMinor);
    else if (REALIZED_TYPES.has(t.type)) realized += t.amountMinor;
    else if (INCOME_TYPES.has(t.type)) income += t.amountMinor;
    else if (MONEY_COST_TYPES.has(t.type)) moneyCosts += Math.abs(t.amountMinor);
    hours += t.hoursSpent;
    flows.push({ date: normalizeUTC(t.date), amountMinor: t.amountMinor });
  }

  if (input.currentValueMinor !== 0) {
    flows.push({ date: normalizeUTC(input.asOf), amountMinor: input.currentValueMinor });
  }

  const grossGain = input.currentValueMinor + realized + income - costBasis;
  const laborCost = roundHalfEven(hours * input.hourlyRateMinor);
  const trueProfit = grossGain - moneyCosts - laborCost;
  const returnPerHour = hours > 0 ? (grossGain - moneyCosts) / hours : null;

  return {
    costBasisMinor: costBasis,
    realizedProceedsMinor: realized,
    incomeMinor: income,
    monetaryCostsMinor: moneyCosts,
    grossGainMinor: grossGain,
    totalHours: hours,
    laborCostMinor: laborCost,
    trueProfitMinor: trueProfit,
    returnPerHourMinor: returnPerHour,
    xirr: xirr(flows),
  };
}

/**
 * Portfolio-wide: one merged cashflow stream (each asset's terminal value
 * at its own asOf date), components summed. Inputs must already share one
 * currency and one hourly rate.
 */
export function computePortfolioReturn(inputs: AssetReturnInput[]): ReturnBreakdown {
  if (inputs.length === 0) {
    return computeAssetReturn({
      transactions: [],
      currentValueMinor: 0,
      asOf: '1970-01-01',
      hourlyRateMinor: 0,
    });
  }

  const per = inputs.map(computeAssetReturn);
  const flows: DatedFlow[] = [];
  for (const input of inputs) {
    for (const t of input.transactions) {
      if (!CASHFLOW_TYPES.has(t.type)) continue;
      flows.push({ date: normalizeUTC(t.date), amountMinor: t.amountMinor });
    }
    if (input.currentValueMinor !== 0) {
      flows.push({ date: normalizeUTC(input.asOf), amountMinor: input.currentValueMinor });
    }
  }

  const sum = (pick: (r: ReturnBreakdown) => number) =>
    per.reduce((acc, r) => acc + pick(r), 0);

  const totalHours = sum((r) => r.totalHours);
  const grossGain = sum((r) => r.grossGainMinor);
  const moneyCosts = sum((r) => r.monetaryCostsMinor);
  const laborCost = sum((r) => r.laborCostMinor);

  return {
    costBasisMinor: sum((r) => r.costBasisMinor),
    realizedProceedsMinor: sum((r) => r.realizedProceedsMinor),
    incomeMinor: sum((r) => r.incomeMinor),
    monetaryCostsMinor: moneyCosts,
    grossGainMinor: grossGain,
    totalHours,
    laborCostMinor: laborCost,
    trueProfitMinor: grossGain - moneyCosts - laborCost,
    returnPerHourMinor: totalHours > 0 ? (grossGain - moneyCosts) / totalHours : null,
    xirr: xirr(flows),
  };
}

/**
 * Convert a transaction stream into another currency at a fixed rate
 * (1 `from` = `rate` `to`), rounding half-even per flow — the bridge from
 * native-currency storage to a single-currency engine call. Per-date
 * historical rates arrive with the FX service in Stage 4.
 */
export function convertTransactions(
  txns: CashTxn[],
  from: string,
  to: string,
  rate: number
): CashTxn[] {
  return txns.map((t) => ({ ...t, amountMinor: convertMinor(t.amountMinor, from, to, rate) }));
}
