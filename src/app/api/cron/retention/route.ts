/**
 * Vercel Cron entry point for data retention.
 *
 * Runs daily. Drops raw webhook bodies older than ninety days and keeps the
 * events, so attendance stays computable and the payloads do not accumulate.
 */

import { formatRetentionRun, pruneSessionEventBodies } from '@/db/retention';
import { safeEqual } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorised(request)) return new Response('Not found', { status: 404 });

  const run = await pruneSessionEventBodies();
  return Response.json({ ok: true, summary: formatRetentionRun(run), ...run });
}
