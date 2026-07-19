import { describe, expect, it } from '@jest/globals';

import { computeCashflow } from './cashflow';

/** §14 input layer: gross earnings = salary + passive income;
 *  net profit = gross − expenses. Salary/expenses are STATED (settings),
 *  passive income is MEASURED — the split stays visible so projections
 *  never masquerade as actuals. */
describe('computeCashflow', () => {
  it('annualizes stated monthlies and adds measured passive income', () => {
    const c = computeCashflow({
      salaryMonthlyMinor: 3000000, // AED 30,000/mo
      expensesMonthlyMinor: 1800000, // AED 18,000/mo
      passiveIncomeMinor: 2101377, // measured YTD (dividends + rent)
    });
    expect(c.salaryAnnualMinor).toBe(36000000);
    expect(c.grossEarningsMinor).toBe(36000000 + 2101377);
    expect(c.expensesAnnualMinor).toBe(21600000);
    expect(c.netProfitMinor).toBe(36000000 + 2101377 - 21600000);
  });

  it('handles zero/unset salary and expenses (passive-only view)', () => {
    const c = computeCashflow({ salaryMonthlyMinor: 0, expensesMonthlyMinor: 0, passiveIncomeMinor: 500 });
    expect(c.grossEarningsMinor).toBe(500);
    expect(c.netProfitMinor).toBe(500);
  });

  it('net profit can be negative — spending beyond earnings is not clamped', () => {
    const c = computeCashflow({ salaryMonthlyMinor: 1000000, expensesMonthlyMinor: 2000000, passiveIncomeMinor: 0 });
    expect(c.netProfitMinor).toBe(12000000 - 24000000);
  });
});
