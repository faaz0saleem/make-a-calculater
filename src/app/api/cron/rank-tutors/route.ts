/**
 * Vercel Cron entry point for the nightly ranking job (SPEC.md §4, §14).
 *
 * Vercel signs scheduled invocations with `CRON_SECRET`; anything without it is
 * refused, so this cannot be used by a passer-by to make the database work.
 */

import { formatRankingRun, runNightlyRanking } from '@/db/ranking';
import { cronAuthorised, cronDenied } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return cronDenied();

  try {
    const run = await runNightlyRanking();
    return Response.json({ ok: true, summary: formatRankingRun(run), ...run });
  } catch (error) {
    console.error('ranking job failed', error);
    return Response.json({ ok: false, error: 'ranking job failed' }, { status: 500 });
  }
}
