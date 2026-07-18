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

/** exchange-api's dated endpoints only reach back this far (per its docs);
 *  anything older 404s on every host, forever — never worth a fetch. */
const FX_HISTORY_FLOOR = '2024-03-02';

/** Session negative cache: `${base}:${quote}:${date}` keys the provider has
 *  confirmed it lacks, so every later refresh stops paying two 10s fetch
 *  timeouts per permanently-missing date. */
const knownMissing = new Set<string>();

const BACKFILL_CONCURRENCY = 4;

/** A run of failures this long means the network is down, not that dates
 *  are missing — abort the pass instead of stacking timeouts. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Test hook: the negative cache is module state. */
export function resetFxMissCache(): void {
  knownMissing.clear();
}

/**
 * Backfill historical rates for every transaction date of foreign-currency
 * assets, so per-date conversion (spec §8) has a real rate at each flow.
 * Skips dates already cached, dates before the provider's history floor,
 * and dates the provider has confirmed missing; fetches run a few at a
 * time and the pass aborts after a run of failures so an offline refresh
 * can't stall pull-to-refresh. A skipped date just leaves a gap that
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

  // A miss only becomes "permanently missing" once a later success proves
  // the network was up; misses before an abort get retried next pass.
  let pendingMisses: string[] = [];
  let consecutiveFailures = 0;

  for (const [currency, dates] of wanted) {
    const have = new Set((await getRateSeries(db, currency, base)).points.map((p) => p.date));
    const todo = [...dates].filter(
      (d) => !have.has(d) && d >= FX_HISTORY_FLOOR && !knownMissing.has(`${currency}:${base}:${d}`)
    );
    for (let i = 0; i < todo.length; i += BACKFILL_CONCURRENCY) {
      const chunk = todo.slice(i, i + BACKFILL_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (date) => ({ date, r: await fetchFxRate(currency, base, date) }))
      );
      for (const { date, r } of results) {
        if (r) {
          await storeRate(db, currency, base, r.date, r.rate);
          for (const key of pendingMisses) knownMissing.add(key);
          pendingMisses = [];
          consecutiveFailures = 0;
        } else {
          pendingMisses.push(`${currency}:${base}:${date}`);
          consecutiveFailures += 1;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
        }
      }
    }
  }
}
