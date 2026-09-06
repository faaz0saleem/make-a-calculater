/**
 * Session reminders (SPEC.md §7).
 *
 * Every five minutes, because the tightest reminder is the tutor's T-10min and
 * a fifteen-minute cadence would send it after the session started.
 *
 * This route existed only as `pnpm reminders` until Phase 8, which meant a
 * production deployment sent no reminders at all: the script was on somebody's
 * laptop and the platform's scheduler knew nothing about it.
 */

import { sendDueReminders } from '@/db/reminders';
import { cronAuthorised, cronDenied } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return cronDenied();

  const report = await sendDueReminders();

  if (report.failed > 0) {
    console.error('reminder job had failures', report);
    return Response.json({ ok: false, ...report }, { status: 500 });
  }

  return Response.json({ ok: true, ...report });
}
