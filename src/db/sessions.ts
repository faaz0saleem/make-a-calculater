/**
 * Session events, and the state changes they drive (SPEC.md §7).
 *
 * Everything a session knows about who was present comes from LiveKit webhooks
 * landing here. The client never reports attendance.
 */

import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { bookings, sessionEvents } from './schema';
import { transitionBooking, type BookingStatus } from '@/lib/bookings/status';
import type { SessionEvent, SessionEventKind } from '@/lib/sessions/attendance';
import { DISPUTE_WINDOW_HOURS } from '@/lib/sessions/window';

export type IncomingSessionEvent = {
  bookingId: string;
  event: SessionEventKind;
  userId: string | null;
  atUtc: Date;
  raw: unknown;
  /** LiveKit's event id, so a redelivery does not double-count. */
  externalId: string;
};

/**
 * Record one webhook.
 *
 * Webhooks arrive more than once. The unique index on the external id makes a
 * redelivery a no-op rather than a second join that would inflate attendance.
 */
export async function recordSessionEvent(
  incoming: IncomingSessionEvent,
  database: DbLike = defaultDb,
): Promise<{ inserted: boolean }> {
  const rows = await database
    .insert(sessionEvents)
    .values({
      bookingId: incoming.bookingId,
      userId: incoming.userId,
      event: incoming.event,
      atUtc: incoming.atUtc,
      externalId: incoming.externalId,
      raw: incoming.raw as never,
    })
    .onConflictDoNothing({ target: sessionEvents.externalId })
    .returning({ id: sessionEvents.id });

  return { inserted: rows.length > 0 };
}

export async function loadSessionEvents(
  bookingId: string,
  database: DbLike = defaultDb,
): Promise<SessionEvent[]> {
  const rows = await database
    .select({ event: sessionEvents.event, userId: sessionEvents.userId, atUtc: sessionEvents.atUtc })
    .from(sessionEvents)
    .where(eq(sessionEvents.bookingId, bookingId))
    .orderBy(asc(sessionEvents.atUtc));

  return rows.map((row) => ({ event: row.event, userId: row.userId, atUtc: row.atUtc }));
}

/**
 * Move a booking's status.
 *
 * Every status write in the codebase goes through `transitionBooking` first
 * (SPEC.md §13.7), so an impossible move throws before it reaches SQL. This is
 * the only function that writes the column.
 */
export async function moveBookingStatus(
  bookingId: string,
  to: BookingStatus,
  extra: Partial<typeof bookings.$inferInsert> = {},
  database: DbLike = defaultDb,
): Promise<BookingStatus> {
  const [current] = await database
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!current) throw new Error(`no booking ${bookingId}`);

  const next = transitionBooking(current.status as BookingStatus, to);

  await database
    .update(bookings)
    .set({ ...extra, status: next, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId));

  return next;
}

/**
 * A confirmed booking becomes `in_progress` the first time somebody actually
 * arrives, so the status reflects reality rather than the clock.
 */
export async function markInProgressIfNeeded(
  bookingId: string,
  database: DbLike = defaultDb,
): Promise<void> {
  const [booking] = await database
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (booking?.status === 'confirmed') {
    await moveBookingStatus(bookingId, 'in_progress', {}, database);
  }
}

export type SettleableBooking = {
  id: string;
  studentId: string;
  tutorId: string;
  isTrial: boolean;
  priceCents: number;
  commissionBps: number;
  startAtUtc: Date;
  durationMinutes: number;
  status: BookingStatus;
};

/**
 * Bookings whose dispute window has closed and whose money has not moved yet.
 *
 * `settled_at is null` is the guard that makes the job safe to run twice.
 */
export async function findBookingsAwaitingSettlement(
  now: Date,
  database: DbLike = defaultDb,
): Promise<SettleableBooking[]> {
  const rows = await database
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      commissionBps: bookings.commissionBps,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        // Anything that has been through a session and is waiting on money.
        inArray(bookings.status, ['confirmed', 'in_progress', 'completed', 'no_show_student', 'no_show_tutor']),
        sql`${bookings.settledAt} is null`,
        // The 24-hour dispute window, measured from the scheduled end. The
        // instant goes in as an ISO string: a bare `Date` in a raw fragment has
        // no column to infer its type from, and the driver refuses it.
        lte(
          sql`${bookings.startAtUtc} + make_interval(mins => ${bookings.durationMinutes})`,
          sql`${now.toISOString()}::timestamptz - make_interval(hours => ${DISPUTE_WINDOW_HOURS})`,
        ),
      ),
    )
    .orderBy(asc(bookings.startAtUtc));

  return rows.map((row) => ({ ...row, status: row.status as BookingStatus }));
}
