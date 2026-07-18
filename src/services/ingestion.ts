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
import { nowISO, uuid } from '@/lib/uuid';
import { createAsset, listAssets } from '@/repositories/assets';
import { enqueueReview } from '@/repositories/reviewQueue';
import { insertTransaction } from '@/repositories/transactions';

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

export async function runImport(db: Db, req: ImportRequest): Promise<ImportSummary> {
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

  // ---- 1. Asset resolution, FIRST ----
  const known: ExistingAsset[] = (await listAssets(db)).map((a) => ({
    id: a.id,
    class: a.class,
    name: a.name,
    symbol: a.symbol,
    platform: a.platform,
  }));
  let assetsCreated = 0;
  const resolved: Array<ParsedTransaction & { assetId: string }> = [];
  for (const row of req.rows) {
    const resolution = resolveAsset(known, row.asset);
    let assetId: string;
    if (resolution.kind === 'existing') {
      assetId = resolution.assetId;
    } else {
      assetId = await createAsset(db, resolution.asset);
      known.push({ id: assetId, ...resolution.asset });
      assetsCreated++;
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
