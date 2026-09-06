/**
 * Vercel Cron entry point for the nightly ledger reconciliation (SPEC.md §12).
 *
 * Returns 500 on drift so the cron run shows up as failed and alerts, rather
 * than quietly logging that the money has gone weird.
 */

import { formatReconciliationReport, reconcileLedger } from '@/db/ledger';
import { cronAuthorised, cronDenied } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return cronDenied();

  const report = await reconcileLedger();
  const summary = formatReconciliationReport(report);

  if (!report.ok) {
    console.error(summary);
    return Response.json({ ok: false, summary, drifts: report.drifts }, { status: 500 });
  }

  return Response.json({ ok: true, summary, entryCount: report.entryCount });
}
