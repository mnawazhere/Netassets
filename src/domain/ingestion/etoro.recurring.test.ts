/**
 * Regression tests for eToro Position ID reuse and account-currency Amount
 * semantics: one Position ID emits many Dividend / Overnight Fee / partial
 * "Position closed" rows, and Amount is always in the account currency —
 * none of which the happy-path fixture in ingestion.test.ts exercises.
 */
import { describe, expect, it } from '@jest/globals';

import { parseEtoroCsv } from './etoro';

const HEADER =
  'Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA';

describe('parseEtoroCsv: recurring rows under one Position ID', () => {
  it('quarterly dividends on the same position get distinct sourceTxnIds', () => {
    const r = parseEtoroCsv(
      [
        HEADER,
        '15/05/2025 09:00:00,Dividend,AAPL/USD,3.75,-,3.75,3.75,100.00,3111001,Stocks,0.00',
        '15/08/2025 09:00:00,Dividend,AAPL/USD,3.80,-,3.80,3.80,103.80,3111001,Stocks,0.00',
      ].join('\n')
    );
    expect(r.transactions).toHaveLength(2);
    expect(r.unparsed).toHaveLength(0);
    const [q2, q3] = r.transactions;
    expect(q2.sourceTxnId).not.toBeNull();
    expect(q2.sourceTxnId).not.toEqual(q3.sourceTxnId);
  });

  it('daily overnight fees each keep a unique sourceTxnId', () => {
    const rows = [1, 2, 3].map(
      (d) =>
        `0${d}/06/2025 22:00:00,Overnight Fee,NSDQ100/USD,0.12,-,-0.12,0.00,99.00,3222002,Stocks,0.00`
    );
    const r = parseEtoroCsv([HEADER, ...rows].join('\n'));
    expect(r.transactions).toHaveLength(3);
    const ids = r.transactions.map((t) => t.sourceTxnId);
    expect(new Set(ids).size).toBe(3);
  });

  it('same-day partial closes with different amounts stay distinct', () => {
    const r = parseEtoroCsv(
      [
        HEADER,
        '10/06/2025 10:00:00,Position closed,AAPL/USD,500.00,2,20.00,20.00,600.00,3111001,Stocks,0.00',
        '10/06/2025 15:00:00,Position closed,AAPL/USD,760.00,3,35.00,55.00,1360.00,3111001,Stocks,0.00',
      ].join('\n')
    );
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0].sourceTxnId).not.toEqual(r.transactions[1].sourceTxnId);
  });

  it('the opening row keeps its stable posId:type key (re-import idempotency)', () => {
    const r = parseEtoroCsv(
      [
        HEADER,
        '15/01/2025 14:32:11,Open Position,AAPL/USD,1853.00,10,0.00,0.00,0.00,3111001,Stocks,0.00',
      ].join('\n')
    );
    expect(r.transactions[0].sourceTxnId).toBe('3111001:open position');
  });
});

describe('parseEtoroCsv: Amount is in the account currency', () => {
  it('stores the txn amount in the account currency, Details ccy only as asset hint', () => {
    const r = parseEtoroCsv(
      [
        HEADER,
        '10/03/2025 09:00:00,Open Position,ADS.DE/EUR,1000.00,5,0.00,0.00,0.00,3333003,Stocks,0.00',
      ].join('\n')
    );
    const [buy] = r.transactions;
    expect(buy.currency).toBe('USD');
    expect(buy.amountMinor).toBe(-100000);
    expect(buy.asset.currency).toBe('EUR');
  });

  it('an unsupported quote currency (GBX) no longer aborts the parse', () => {
    const r = parseEtoroCsv(
      [
        HEADER,
        '10/03/2025 09:00:00,Open Position,BARC.L/GBX,250.00,50,0.00,0.00,0.00,3444004,Stocks,0.00',
      ].join('\n')
    );
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].currency).toBe('USD');
    expect(r.transactions[0].amountMinor).toBe(-25000);
  });

  it('a row toMinor cannot represent is surfaced in unparsed, not thrown', () => {
    const r = parseEtoroCsv(
      [
        HEADER,
        '10/03/2025 09:00:00,Fee,BTC/USD,0.005,-,-0.005,0.00,0.00,3555005,Crypto,0.00',
        '11/03/2025 09:00:00,Dividend,AAPL/USD,3.75,-,3.75,3.75,3.75,3111001,Stocks,0.00',
      ].join('\n')
    );
    expect(r.unparsed).toHaveLength(1);
    expect(r.unparsed[0]).toContain('0.005');
    expect(r.transactions).toHaveLength(1); // the good row still imports
  });
});
