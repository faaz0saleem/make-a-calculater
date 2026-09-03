/**
 * Vercel Cron entry point for the nightly ranking job (SPEC.md §4, §14).
 *
 * Vercel signs scheduled invocations with `CRON_SECRET`; anything without it is
 * refused, so this cannot be used by a passer-by to make the database work.
 */

import { formatRankingRun, recomputeTutorRanking } from '@/db/ranking';
import { safeEqual } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Without a configured secret the endpoint stays shut rather than open.
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  return safeEqual(header, `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const run = await recomputeTutorRanking();
    return Response.json({ ok: true, summary: formatRankingRun(run), ...run });
  } catch (error) {
    console.error('ranking job failed', error);
    return Response.json({ ok: false, error: 'ranking job failed' }, { status: 500 });
  }
}
