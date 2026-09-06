/**
 * Vercel Cron entry point for settlement (SPEC.md §2, §7).
 *
 * Runs hourly rather than nightly: a session that ended at 09:05 should settle
 * about 24 hours later, not at whatever time the nightly job happens to run.
 */

import { formatSettlementRun, runSettlement } from '@/db/settlement';
import { cronAuthorised, cronDenied } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return cronDenied();

  const run = await runSettlement();
  const summary = formatSettlementRun(run);

  if (run.skipped.length > 0) {
    console.error(summary, run.skipped);
    return Response.json({ ok: false, summary, skipped: run.skipped }, { status: 500 });
  }

  return Response.json({ ok: true, summary, settled: run.settled.length });
}
