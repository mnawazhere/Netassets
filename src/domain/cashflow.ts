/**
 * Cashflow statement (spec §14 input layer): the salary/spend side the
 * tracker doesn't measure. Salary and expenses are STATED monthly figures
 * (settings); passive income is MEASURED (DIVIDEND/RENT rows). All minor
 * units in the base currency.
 *
 * Hard principle (§14): stated figures feed the cashflow/projection
 * surface ONLY — they never write into, or blend silently with, measured
 * NAV or returns.
 */

export interface CashflowInput {
  /** Stated take-home salary per month, minor units. */
  salaryMonthlyMinor: number;
  /** Stated general spending per month, minor units. */
  expensesMonthlyMinor: number;
  /** Measured passive income for the year (income view total). */
  passiveIncomeMinor: number;
}

export interface Cashflow {
  salaryAnnualMinor: number;
  /** salary (stated, annualized) + passive income (measured). */
  grossEarningsMinor: number;
  expensesAnnualMinor: number;
  /** gross − expenses; the §14 "net annual surplus". May be negative. */
  netProfitMinor: number;
}

export function computeCashflow(input: CashflowInput): Cashflow {
  const salaryAnnualMinor = input.salaryMonthlyMinor * 12;
  const expensesAnnualMinor = input.expensesMonthlyMinor * 12;
  const grossEarningsMinor = salaryAnnualMinor + input.passiveIncomeMinor;
  return {
    salaryAnnualMinor,
    grossEarningsMinor,
    expensesAnnualMinor,
    netProfitMinor: grossEarningsMinor - expensesAnnualMinor,
  };
}
