/**
 * Data retention (DECISIONS_NEEDED.md item 21, now decided).
 *
 * Every LiveKit webhook is stored whole, which is what lets a dispute be
 * answered from evidence rather than memory. It also accumulates participant
 * identities and connection metadata indefinitely, for sessions nobody will
 * ever ask about again.
 *
 * So: **ninety days, then the body goes and the event stays.** What remains —
 * which event, whose, when, and the provider's id — is everything attendance is
 * computed from, so `summariseAttendance` still works on a five-year-old
 * booking. What goes is the raw payload, which is only useful while a dispute
 * is live, and the dispute window is one day.
 */

import { sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';

/** How long a raw webhook body is kept. */
export const RAW_EVENT_RETENTION_DAYS = 90;

export type RetentionRun = {
  ranAt: Date;
  cutoff: Date;
  bodiesDropped: number;
};

/**
 * Drop the bodies of session events older than the retention window.
 *
 * Deliberately an `update`, not a `delete`: losing the event would lose the
 * attendance it proves, and with it the ability to explain a payment.
 */
export async function pruneSessionEventBodies(
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<RetentionRun> {
  const cutoff = new Date(now.getTime() - RAW_EVENT_RETENTION_DAYS * 86_400_000);

  const rows = (await database.execute(sql`
    update session_events
       set raw = '{}'::jsonb
     where at_utc < ${cutoff.toISOString()}::timestamptz
       and raw <> '{}'::jsonb
    returning id
  `)) as unknown as { id: string }[];

  return { ranAt: now, cutoff, bodiesDropped: rows.length };
}

export function formatRetentionRun(run: RetentionRun): string {
  return run.bodiesDropped === 0
    ? `Retention: nothing older than ${RAW_EVENT_RETENTION_DAYS} days still had a body.`
    : `Retention: dropped ${run.bodiesDropped} webhook bodies older than ${RAW_EVENT_RETENTION_DAYS} days. The events themselves are kept.`;
}
