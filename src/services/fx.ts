/** FX service: keeps fx_rates a DATED series (spec §8 v4) and hands the
 *  domain layer RateSeries objects. Fetch failures leave cache untouched. */
import { and, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { assets, fxRates, transactions } from '@/db/schema';
import { makeRateSeries, type RateSeries } from '@/domain/fx';
import { uuid } from '@/lib/uuid';

import { fetchFxRate } from './providers';

export async function getRateSeries(db: Db, base: string, quote: string): Promise<RateSeries> {
  const rows = await db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.base, base.toUpperCase()), eq(fxRates.quote, quote.toUpperCase())));
  return makeRateSeries(rows.map((r) => ({ date: r.asOf.slice(0, 10), rate: r.rate })));
}

async function storeRate(db: Db, base: string, quote: string, date: string, rate: number) {
  await db
    .insert(fxRates)
    .values({ id: uuid(), base: base.toUpperCase(), quote: quote.toUpperCase(), rate, asOf: date })
    .onConflictDoNothing();
}

/** Currencies present in the portfolio that differ from the base. */
export async function foreignCurrencies(db: Db, baseCurrency: string): Promise<string[]> {
  const rows = await db.select({ currency: assets.currency }).from(assets);
  return [...new Set(rows.map((r) => r.currency.toUpperCase()))].filter(
    (c) => c !== baseCurrency.toUpperCase()
  );
}

/** Pull today's rate for every foreign→base pair. */
export async function refreshLatestRates(db: Db, baseCurrency: string): Promise<void> {
  for (const currency of await foreignCurrencies(db, baseCurrency)) {
    const r = await fetchFxRate(currency, baseCurrency, 'latest');
    if (r) await storeRate(db, currency, baseCurrency, r.date, r.rate);
  }
}

/**
 * Backfill historical rates for every transaction date of foreign-currency
 * assets, so per-date conversion (spec §8) has a real rate at each flow.
 * Skips dates already cached; a failed fetch just leaves a gap that
 * rateOn() carries forward over.
 */
export async function backfillHistoricalRates(db: Db, baseCurrency: string): Promise<void> {
  const base = baseCurrency.toUpperCase();
  const rows = await db
    .select({ date: transactions.date, currency: transactions.currency })
    .from(transactions);

  const wanted = new Map<string, Set<string>>();
  for (const r of rows) {
    const c = r.currency.toUpperCase();
    if (c === base) continue;
    if (!wanted.has(c)) wanted.set(c, new Set());
    wanted.get(c)!.add(r.date);
  }

  for (const [currency, dates] of wanted) {
    const have = new Set((await getRateSeries(db, currency, base)).points.map((p) => p.date));
    for (const date of dates) {
      if (have.has(date)) continue;
      const r = await fetchFxRate(currency, base, date);
      if (r) await storeRate(db, currency, base, r.date, r.rate);
    }
  }
}
