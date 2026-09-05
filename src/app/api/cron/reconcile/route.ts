/**
 * Vercel Cron entry point for the nightly ledger reconciliation (SPEC.md §12).
 *
 * Returns 500 on drift so the cron run shows up as failed and alerts, rather
 * than quietly logging that the money has gone weird.
 */

import { formatReconciliationReport, reconcileLedger } from '@/db/ledger';
import { safeEqual } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return new Response('Not found', { status: 404 });
  }

  const report = await reconcileLedger();
  const summary = formatReconciliationReport(report);

  if (!report.ok) {
    console.error(summary);
    return Response.json({ ok: false, summary, drifts: report.drifts }, { status: 500 });
  }

  return Response.json({ ok: true, summary, entryCount: report.entryCount });
}
