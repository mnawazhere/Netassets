import { describe, expect, it } from '@jest/globals';

import { listRowMetrics, shouldShowPerHour } from './display';
import { computeAssetReturn } from './returns/engine';

/**
 * Stage 7A acceptance (§5 display rules v9), against the seed's Pokémon
 * box: bought ¥5,800 with 5 hrs, marked at ¥45,000 — a 7.76× winner that
 * the old labor-blended row rendered as roughly −423%.
 */
const pokemon = computeAssetReturn({
  transactions: [
    { type: 'BUY', date: '2023-09-22', amountMinor: -5800, hoursSpent: 5 },
  ],
  currentValueMinor: 45000,
  asOf: '2025-06-01',
  // 5 hrs at an AED 300/hr baseline ≈ ¥62,760 at ~0.0239 — dwarfs the basis.
  hourlyRateMinor: 12552,
});

describe('Stage 7A acceptance — the Pokémon box row', () => {
  it("the row's money return is strongly POSITIVE (it 7.76×'d)", () => {
    const row = listRowMetrics(pokemon, true);
    expect(row.moneyReturnFraction).not.toBeNull();
    expect(row.moneyReturnFraction!).toBeCloseTo((45000 - 5800) / 5800, 6); // +675.9%
    expect(row.moneyReturnFraction!).toBeGreaterThan(6);
  });

  it('the old labor-blended figure really was absurd — and is NOT what rows show', () => {
    const laborBlended = pokemon.trueProfitMinor / pokemon.costBasisMinor;
    expect(laborBlended).toBeLessThan(-4); // ≈ −406% territory: the bug
    expect(listRowMetrics(pokemon, true).moneyReturnFraction).not.toBeCloseTo(laborBlended, 2);
  });

  it('row metrics structurally contain NO per-hour and NO labor figure', () => {
    const row = listRowMetrics(pokemon, true);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('perHour');
    expect(serialized).not.toContain('PerHour');
    expect(serialized).not.toContain('labor');
    expect(Object.keys(row).sort()).toEqual(['moneyReturnFraction', 'stale']);
  });

  it('the time lens survives on detail: true profit, hours, verdict inputs intact', () => {
    expect(pokemon.totalHours).toBe(5);
    expect(pokemon.laborCostMinor).toBe(62760);
    expect(pokemon.trueProfitMinor).toBe(45000 - 5800 - 62760); // labor priced, in currency
    expect(pokemon.returnPerHourMinor).not.toBeNull(); // detail-only figure still computed
  });
});

describe('money return is simple total, never annualized', () => {
  it('a 2-week-old position up 4% shows ~4%, not ~+900%/yr', () => {
    const r = computeAssetReturn({
      transactions: [{ type: 'BUY', date: '2025-07-04', amountMinor: -100000, hoursSpent: 0.1 }],
      currentValueMinor: 104000,
      asOf: '2025-07-18',
      hourlyRateMinor: 30000,
    });
    expect(r.moneyReturnFraction!).toBeCloseTo(0.04, 10);
    // The annualized figure explodes exactly as §5 warns — and stays off rows.
    expect(r.xirr!).toBeGreaterThan(1.5);
  });

  it('zero basis (pure income stream) → null, not division blow-up', () => {
    const r = computeAssetReturn({
      transactions: [{ type: 'RENT', date: '2025-01-01', amountMinor: 700000, hoursSpent: 10 }],
      currentValueMinor: 0,
      asOf: '2025-07-01',
      hourlyRateMinor: 30000,
    });
    expect(r.moneyReturnFraction).toBeNull();
  });
});

describe('per-hour suppression on detail', () => {
  it('trivially small hours are suppressed', () => {
    expect(shouldShowPerHour(0.1)).toBe(false);
    expect(shouldShowPerHour(0.9)).toBe(false);
  });

  it('real time investments show the worth-it line', () => {
    expect(shouldShowPerHour(1)).toBe(true);
    expect(shouldShowPerHour(120)).toBe(true);
  });
});
