/**
 * Standing arrangements (SPEC.md §5).
 *
 * Hourly. This job materialises four weeks ahead, warns at T-72h, debits at
 * T-48h and lapses what went unpaid — so a deployment where it is not running
 * is one where standing sessions quietly stop being paid for and then quietly
 * stop happening.
 *
 * Like reminders, it existed only as a script until Phase 8.
 */

import { runSeriesJobs } from '@/db/series';
import { cronAuthorised, cronDenied } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return cronDenied();

  const report = await runSeriesJobs();
  return Response.json({ ok: true, ...report });
}
