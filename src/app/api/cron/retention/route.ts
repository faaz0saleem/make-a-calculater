/**
 * Vercel Cron entry point for data retention.
 *
 * Runs daily. Drops raw webhook bodies older than ninety days and keeps the
 * events, so attendance stays computable and the payloads do not accumulate.
 */

import { formatRetentionRun, pruneSessionEventBodies } from '@/db/retention';
import { cronAuthorised, cronDenied } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return cronDenied();

  const run = await pruneSessionEventBodies();
  return Response.json({ ok: true, summary: formatRetentionRun(run), ...run });
}
