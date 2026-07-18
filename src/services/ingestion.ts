/**
 * The import pipeline (spec §6). Order is load-bearing:
 *   1. asset resolution (existing asset or create)  ← FIRST, always
 *   2. fingerprint + dedup plan                     ← needs resolved ids
 *   3. execute: insert / skip / queue for review
 * A duplicate fingerprint must never surface as an uncaught DB throw — the
 * planner prevents it, and the insert path catches the unique-index
 * violation as a final belt-and-braces skip.
 */
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { imports, transactions } from '@/db/schema';
import { analyzeCoverage, type CoverageReport } from '@/domain/ingestion/coverage';
import { planRow } from '@/domain/ingestion/dedup';
import { resolveAsset, type ExistingAsset } from '@/domain/ingestion/resolution';
import type { CoveredRange, ExistingTxn, ParsedTransaction } from '@/domain/ingestion/types';
import type { Binding } from '@/domain/symbols/resolver';
import { nowISO, uuid } from '@/lib/uuid';
import { createAsset, listAssets } from '@/repositories/assets';
import { enqueueBindingReview, enqueueReview } from '@/repositories/reviewQueue';
import { loadCacheLookup, saveMapping } from '@/repositories/symbolMappings';
import { insertTransaction } from '@/repositories/transactions';

import { liveTestFetch, verifyCandidate, type TestFetch } from './bindingFlow';
import { refreshPriceFor } from './pricing';
import { bindHint } from './resolution';

export interface ImportRequest {
  fileName: string;
  kind: 'pdf' | 'csv' | 'screenshot' | 'voice';
  platform?: string | null;
  sourceAccount?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  rows: ParsedTransaction[];
}

export interface ImportSummary {
  importId: string;
  inserted: number;
  skippedExact: number;
  queuedForReview: number;
  assetsCreated: number;
  coverage: CoverageReport;
}

export interface ImportDeps {
  /** Gate 1 for dominant binding hypotheses found during import. */
  testFetch?: TestFetch;
  /** Prices newly created bound assets; injectable for hermetic tests. */
  refreshPrice?: typeof refreshPriceFor;
}

export async function runImport(
  db: Db,
  req: ImportRequest,
  depsIn: ImportDeps = {}
): Promise<ImportSummary> {
  const deps = { testFetch: liveTestFetch, refreshPrice: refreshPriceFor, ...depsIn };
  // Coverage context from prior processed statements.
  const prior = await db.select().from(imports).where(eq(imports.status, 'processed'));
  const coveredRanges: CoveredRange[] = prior
    .filter((i) => i.periodStart && i.periodEnd)
    .map((i) => ({
      sourceAccount: i.sourceAccount,
      periodStart: i.periodStart!,
      periodEnd: i.periodEnd!,
    }));
  const coverage = analyzeCoverage(
    coveredRanges,
    {
      sourceAccount: req.sourceAccount ?? null,
      periodStart: req.periodStart ?? '0000-01-01',
      periodEnd: req.periodEnd ?? '9999-12-31',
    }
  );

  const importId = uuid();
  await db.insert(imports).values({
    id: importId,
    fileName: req.fileName,
    kind: req.kind,
    platform: req.platform ?? null,
    sourceAccount: req.sourceAccount ?? null,
    periodStart: req.periodStart ?? null,
    periodEnd: req.periodEnd ?? null,
    status: 'pending',
    importedAt: nowISO(),
  });

  // ---- 1. Asset resolution, FIRST — through the SHARED binding path ----
  const bindingCache = await loadCacheLookup(db);
  const known: ExistingAsset[] = (await listAssets(db)).map((a) => ({
    id: a.id,
    class: a.class,
    name: a.name,
    symbol: a.symbol,
    platform: a.platform,
    providerId: a.providerId,
  }));
  let assetsCreated = 0;
  const resolved: (ParsedTransaction & { assetId: string })[] = [];
  for (const row of req.rows) {
    const { hint, dominantCandidate } = bindHint(row.asset, bindingCache);
    const resolution = resolveAsset(known, hint);
    let assetId: string;
    if (resolution.kind === 'existing') {
      assetId = resolution.assetId;
    } else {
      // Dominant hypothesis on the no-human import path (§6 v10): the
      // asset is created UNPRICED and the candidate goes through gate 1
      // (test-fetch) into the review queue — never silently bind-and-price.
      assetId = await createAsset(db, resolution.asset);
      known.push({ id: assetId, ...resolution.asset });
      assetsCreated++;
      if (resolution.asset.providerId) {
        await saveMapping(
          db,
          {
            displayName: resolution.asset.name,
            symbol: resolution.asset.symbol!,
            class: hint.class as Binding['class'],
            providerId: resolution.asset.providerId,
            currency: resolution.asset.currency,
          },
          'index',
          row.asset.symbol ?? row.asset.name ?? undefined
        );
        // Price it now so the asset isn't valueless until next app open.
        await deps.refreshPrice(db, resolution.asset);
      } else if (dominantCandidate) {
        const gate = await verifyCandidate(dominantCandidate, {
          testFetch: deps.testFetch,
          proposer: async () => null, // dominant path: no AI involved
          aiEnabled: async () => false,
        });
        if (gate.outcome === 'awaiting-confirmation') {
          await enqueueBindingReview(db, {
            importId,
            assetId,
            candidate: dominantCandidate,
            fetchedPriceMinor: gate.gate.fetchedPriceMinor,
          });
        }
        // test-fetch fail → asset simply stays unpriced (manual-unpriced).
      }
    }
    resolved.push({ ...row, assetId });
  }

  // ---- 2 + 3. Plan and execute per row ----
  const existingRows = await db.select().from(transactions);
  const existing: ExistingTxn[] = existingRows.map((t) => ({
    id: t.id,
    assetId: t.assetId,
    fingerprint: t.fingerprint,
    type: t.type,
    date: t.date,
    amountMinor: t.amountMinor,
    quantity: t.quantity,
    sourceAccount: t.sourceAccount,
  }));

  let inserted = 0;
  let skippedExact = 0;
  let queuedForReview = 0;

  for (const row of resolved) {
    const plan = planRow(row, { existing, coveredRanges });

    if (plan.action === 'skip-exact') {
      skippedExact++;
      continue;
    }

    if (plan.action === 'review') {
      await enqueueReview(db, {
        importId,
        assetId: row.assetId,
        payload: row,
        reason: plan.reason,
        conflictsWith: plan.conflictsWith,
      });
      queuedForReview++;
      continue;
    }

    try {
      const id = await insertTransaction(
        db,
        {
          assetId: row.assetId,
          type: row.type,
          date: row.date,
          amountMinor: row.amountMinor,
          currency: row.currency,
          quantity: row.quantity ?? null,
          hoursSpent: row.hoursSpent ?? 0,
          sourceAccount: row.sourceAccount ?? null,
          sourceTxnId: row.sourceTxnId ?? null,
          sourceRef: importId,
          note: row.note ?? null,
        },
        'import'
      );
      existing.push({
        id,
        assetId: row.assetId,
        fingerprint: plan.fingerprint,
        type: row.type,
        date: row.date,
        amountMinor: row.amountMinor,
        quantity: row.quantity ?? null,
        sourceAccount: row.sourceAccount ?? null,
      });
      inserted++;
    } catch (e) {
      // Belt-and-braces (spec §6): a racing unique-index violation is a
      // skip, never an uncaught throw.
      if (String(e).toLowerCase().includes('unique')) {
        skippedExact++;
      } else {
        throw e;
      }
    }
  }

  await db.update(imports).set({ status: 'processed' }).where(eq(imports.id, importId));

  return { importId, inserted, skippedExact, queuedForReview, assetsCreated, coverage };
}
