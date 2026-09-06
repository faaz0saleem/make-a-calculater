/**
 * The outbox drain (SPEC.md §11).
 *
 * Every five minutes. Email is queued by whatever was happening at the time and
 * sent here, so a provider having a bad minute costs a retry rather than a
 * booking, and a message that cannot be sent at all ends up in dead letters
 * where an admin can see it.
 *
 * Returns 500 when anything died, so the platform's own cron history shows a
 * failed run. A queue that quietly stops is the failure this whole design is
 * built to make impossible.
 */

import { drainEmailQueue } from '@/db/email-queue';
import { cronAuthorised, cronDenied } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return cronDenied();

  const report = await drainEmailQueue();

  if (report.dead > 0) {
    console.error('email queue produced dead letters', report);
    return Response.json({ ok: false, ...report }, { status: 500 });
  }

  return Response.json({ ok: true, ...report });
}
