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
import { classifyOutcome } from '@/lib/money/outcomes';
import { summariseAttendance, type SessionEvent, type SessionEventKind } from '@/lib/sessions/attendance';
import { DISPUTE_WINDOW_HOURS, sessionWindow } from '@/lib/sessions/window';

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

/**
 * Close a session that has clearly finished (SPEC.md §7, §9).
 *
 * Called when LiveKit says the room is empty. It asks the same question
 * settlement will ask a day later — did both people spend at least half the
 * booked time in the room — and if the answer is yes, moves the booking to
 * `completed` and stamps `completed_at`.
 *
 * Two things depend on that stamp: the booking stops reading as "in progress"
 * the moment the lesson ends rather than a day later, and the student can leave
 * a review straight away instead of waiting for the money to move.
 *
 * No money is decided here. `classifyOutcome` is the pure classifier
 * `resolveBookingOutcome` uses; settlement still makes the money call, and a
 * booking this function leaves alone is settled exactly as before.
 */
export async function completeIfAttended(
  bookingId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<boolean> {
  const [booking] = await database
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
      completedAt: bookings.completedAt,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) return false;
  if (booking.completedAt) return true;
  if (booking.status !== 'in_progress') return false;

  const window = sessionWindow(booking.startAtUtc, booking.durationMinutes);
  const events = await loadSessionEvents(booking.id, database);

  const attendance = summariseAttendance({
    events,
    window,
    studentId: booking.studentId,
    tutorId: booking.tutorId,
    now,
  });

  const resolution = classifyOutcome(
    {
      id: booking.id,
      studentId: booking.studentId,
      tutorId: booking.tutorId,
      isTrial: booking.isTrial,
      priceCents: booking.priceCents,
      commissionBps: booking.commissionBps,
      startAtUtc: booking.startAtUtc,
      durationMinutes: booking.durationMinutes,
    },
    attendance,
  );

  if (resolution !== 'completed') return false;

  await moveBookingStatus(booking.id, 'completed', { completedAt: now }, database);
  return true;
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
  /** Set if the session was already closed as having happened. */
  completedAt: Date | null;
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
      completedAt: bookings.completedAt,
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
