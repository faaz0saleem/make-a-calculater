/**
 * Creating, moving and cancelling a paid booking (SPEC.md §5).
 *
 * The whole point of this file is one transaction. Checking the slot, debiting
 * the student's credits into escrow, and inserting the booking happen together
 * or not at all — at `serializable` isolation, so two students pressing the
 * same slot forty milliseconds apart cannot both succeed.
 *
 * Three independent things stop a double booking, and that is deliberate:
 *
 *  1. `booking_no_overlap`, a partial unique index on `(tutor_id, start_at_utc)`
 *     over live statuses. This is the guarantee; the rest are politeness.
 *  2. `serializable` isolation, so the read that decided the slot was free is
 *     part of what gets serialised.
 *  3. The availability engine, run against the transaction's own view.
 *
 * A loser of that race gets `slot_taken`, whether Postgres told us through the
 * unique index (23505) or a serialization failure (40001).
 */

import { and, count, desc, eq, gt, ne, sql } from 'drizzle-orm';

import { appendLedger } from './ledger';
import { db as defaultDb, type Database } from './client';
import type { DbLike } from './ledger';
import { emailBookingCancelled, emailBookingConfirmed } from './email-events';
import { moveBookingStatus } from './sessions';
import { bookings, rescheduleRequests, slotHolds, studentWallets, tutorProfiles, users } from './schema';
import { DatabaseAvailability } from '@/lib/availability/database';
import { commissionBpsFor } from '@/lib/money/commission';
import { hasInstantBooking } from '@/lib/tutors/reliability';
import { bookingEscrowEntries } from '@/lib/money/ledger';
import { priceForBooking, type BookableDuration } from '@/lib/money/pricing';
import { holdExpiresAt } from '@/lib/bookings/holds';
import {
  isRescheduleExpired,
  rescheduleExpiresAt,
  rescheduleProblem,
  type RescheduleProblem,
} from '@/lib/bookings/reschedule';

export type BookingFailure =
  | 'no_such_tutor'
  | 'not_bookable'
  | 'own_profile'
  | 'slot_taken'
  | 'not_available'
  | 'insufficient_credits'
  | 'bad_duration'
  | 'guardian_required';

export type CreateBookingResult =
  | {
      ok: true;
      bookingId: string;
      priceCents: number;
      commissionBps: number;
      /** True when the tutor has lost instant booking and must accept first. */
      needsAcceptance: boolean;
    }
  | { ok: false; problem: BookingFailure; shortfallCents?: number };

/**
 * Postgres codes that mean "somebody else got there first".
 *
 * The code is looked for down the cause chain, not just on the error itself:
 * Drizzle wraps a driver error in a `DrizzleQueryError` whose own `code` is
 * undefined, and a race that reads as an unhandled 500 is a race the student
 * sees as a crash rather than as "that slot just went".
 */
const RACE_CODES = new Set([
  '23505', // unique_violation — booking_no_overlap
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

function isRaceLoss(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: string }).code;
    if (typeof code === 'string' && RACE_CODES.has(code)) return true;

    const message = current instanceof Error ? current.message : String(current);
    if (message.includes('booking_no_overlap') || message.includes('could not serialize')) return true;

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * Whether this student has already had a session with this tutor that actually
 * happened — the one fact the commission rate turns on.
 */
export async function hasCompletedPaidSession(
  studentId: string,
  tutorId: string,
  database: DbLike,
): Promise<boolean> {
  const [row] = await database
    .select({ total: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.studentId, studentId),
        eq(bookings.tutorId, tutorId),
        eq(bookings.isTrial, false),
        sql`${bookings.completedAt} is not null`,
      ),
    );

  return (row?.total ?? 0) > 0;
}

/**
 * Book a paid session.
 *
 * `now` is a parameter so tests can place a booking against a fixed clock.
 */
export async function createBooking(
  input: {
    studentId: string;
    tutorId: string;
    startAtUtc: Date;
    durationMinutes: BookableDuration;
    subjectId?: string | null;
  },
  now = new Date(),
  database: Database = defaultDb,
): Promise<CreateBookingResult> {
  if (input.studentId === input.tutorId) return { ok: false, problem: 'own_profile' };
  if (input.durationMinutes !== 30 && input.durationMinutes !== 60) {
    return { ok: false, problem: 'bad_duration' };
  }

  try {
    const result: CreateBookingResult = await database.transaction(
      async (tx) => {
        const [tutor] = await tx
          .select({
            userId: tutorProfiles.userId,
            status: tutorProfiles.status,
            hourlyCents: tutorProfiles.hourlyCents,
            halfHourCents: tutorProfiles.halfHourCents,
            promoCents: tutorProfiles.promoCents,
            promoStartsAt: tutorProfiles.promoStartsAt,
            promoEndsAt: tutorProfiles.promoEndsAt,
            negotiatedCommissionBps: tutorProfiles.commissionBps,
            strikes: tutorProfiles.strikes,
            timezone: users.timezone,
            suspendedAt: users.suspendedAt,
          })
          .from(tutorProfiles)
          .innerJoin(users, eq(users.id, tutorProfiles.userId))
          .where(eq(tutorProfiles.userId, input.tutorId))
          .limit(1);

        if (!tutor) return { ok: false, problem: 'no_such_tutor' as const };
        if (tutor.status !== 'verified' || tutor.suspendedAt) {
          return { ok: false, problem: 'not_bookable' as const };
        }

        const [student] = await tx
          .select({
            timezone: users.timezone,
            creditsCents: studentWallets.creditsCents,
            isAdult: users.isAdult,
            guardianEmail: users.guardianEmail,
          })
          .from(users)
          .innerJoin(studentWallets, eq(studentWallets.userId, users.id))
          .where(eq(users.id, input.studentId))
          .limit(1);

        if (!student) return { ok: false, problem: 'no_such_tutor' as const };

        // A minor cannot enter a paid session without a guardian on record
        // (SPEC.md §1). The booking form marks the field `required`, which is
        // an attribute in someone else's browser — this is the check.
        if (student.isAdult === false && !student.guardianEmail) {
          return { ok: false, problem: 'guardian_required' as const };
        }

        // Price and commission are decided here and never again. A rate change
        // tomorrow cannot reach this row (SPEC.md §5).
        const { priceCents } = priceForBooking({
          rates: {
            hourlyCents: tutor.hourlyCents,
            halfHourCents: tutor.halfHourCents,
            promoCents: tutor.promoCents,
            promoStartsAt: tutor.promoStartsAt,
            promoEndsAt: tutor.promoEndsAt,
          },
          durationMinutes: input.durationMinutes,
          isTrial: false,
          now,
        });

        if (student.creditsCents < priceCents) {
          return {
            ok: false,
            problem: 'insufficient_credits' as const,
            shortfallCents: priceCents - student.creditsCents,
          };
        }

        // Somebody else's live hold on this slot stops us before we take it.
        const [held] = await tx
          .select({ studentId: slotHolds.studentId })
          .from(slotHolds)
          .where(
            and(
              eq(slotHolds.tutorId, input.tutorId),
              eq(slotHolds.startAtUtc, input.startAtUtc),
              ne(slotHolds.studentId, input.studentId),
              gt(slotHolds.expiresAt, now),
            ),
          )
          .limit(1);

        if (held) return { ok: false, problem: 'slot_taken' as const };

        // The engine, run against this transaction's view of the bookings
        // table — not the pool's, which would be a read outside the isolation
        // this whole function exists to get. A 60-minute session needs two
        // contiguous free slots, which falls out of asking for 60 minutes.
        const availability = new DatabaseAvailability(tx);
        const free = await availability.freeSlotsFor({
          tutorId: input.tutorId,
          durationMinutes: input.durationMinutes,
          fromUtc: new Date(input.startAtUtc.getTime() - 1),
          toUtc: new Date(input.startAtUtc.getTime() + (input.durationMinutes + 1) * 60_000),
          limit: 4,
        });

        if (
          !free.known ||
          !free.value.some((slot) => slot.startUtc.getTime() === input.startAtUtc.getTime())
        ) {
          return { ok: false, problem: 'not_available' as const };
        }

        // The retention rate, floored by anything negotiated with this tutor
        // during recruitment — the lower of the two, never the higher.
        const commissionBps = commissionBpsFor(
          await hasCompletedPaidSession(input.studentId, input.tutorId, tx),
          tutor.negotiatedCommissionBps,
        );

        /**
         * A tutor who has missed sessions stops confirming automatically
         * (SPEC.md §2, §7).
         *
         * The credits still move into escrow — the slot is genuinely taken and
         * the student has genuinely committed — but the hour is not promised
         * until the tutor says so. If they never do, `expireUnacceptedBookings`
         * gives the money back in full.
         */
        const instant = hasInstantBooking(tutor.strikes ?? 0);

        const [created] = await tx
          .insert(bookings)
          .values({
            studentId: input.studentId,
            tutorId: input.tutorId,
            subjectId: input.subjectId ?? null,
            isTrial: false,
            startAtUtc: input.startAtUtc,
            durationMinutes: input.durationMinutes,
            status: instant ? 'confirmed' : 'pending_tutor',
            priceCents,
            commissionBps,
            studentTz: student.timezone,
            tutorTz: tutor.timezone,
          })
          .returning({ id: bookings.id });

        const bookingId = created!.id;

        await tx
          .update(bookings)
          .set({ livekitRoom: `booking_${bookingId}` })
          .where(eq(bookings.id, bookingId));

        await appendLedger(
          tx,
          bookingEscrowEntries({ bookingId, studentId: input.studentId, priceCents }),
        );

        // Their own hold has done its job.
        await tx
          .delete(slotHolds)
          .where(
            and(
              eq(slotHolds.studentId, input.studentId),
              eq(slotHolds.tutorId, input.tutorId),
              eq(slotHolds.startAtUtc, input.startAtUtc),
            ),
          );

        return { ok: true as const, bookingId, priceCents, commissionBps, needsAcceptance: !instant };
      },
      { isolationLevel: 'serializable' },
    );

    // Outside the transaction on purpose. The booking is the thing that had to
    // be atomic; queueing a receipt inside a serializable transaction would add
    // one more chance to lose the race and roll back a lesson over an email.
    // A booking waiting for the tutor gets its receipt when they accept.
    if (result.ok && !result.needsAcceptance) await emailBookingConfirmed(result.bookingId, database);

    return result;
  } catch (error) {
    if (isRaceLoss(error)) return { ok: false, problem: 'slot_taken' };
    throw error;
  }
}

/**
 * What the student typed that no chapter covers.
 *
 * Scoped to the student on the booking inside the query, so a stray id in a
 * form cannot write a note onto somebody else's session. The tutor reads it
 * before the lesson, and before accepting a trial.
 */
export async function setBookingNote(
  bookingId: string,
  studentId: string,
  note: string,
  database: DbLike = defaultDb,
): Promise<void> {
  await database
    .update(bookings)
    .set({ topicNote: note.slice(0, 2_000) || null, updatedAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.studentId, studentId)));
}

/**
 * Say yes to a booking that is waiting on you.
 *
 * Scoped to the tutor on the row inside the update, and routed through the
 * state machine, so `pending_tutor -> confirmed` is the only move it can make.
 * No money changes: the credits went into escrow when the student committed.
 */
export async function acceptPendingBooking(
  bookingId: string,
  tutorId: string,
  database: Database = defaultDb,
): Promise<{ ok: boolean; reason?: string }> {
  const [booking] = await database
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tutorId, tutorId)))
    .limit(1);

  if (!booking) return { ok: false, reason: 'That booking could not be found.' };
  if (booking.status !== 'pending_tutor') {
    return { ok: false, reason: 'That booking is no longer waiting for an answer.' };
  }

  await moveBookingStatus(bookingId, 'confirmed', {}, database);

  // Now it is real. The student has been holding a paid booking nobody had
  // agreed to, so this is the message they have been waiting for.
  await emailBookingConfirmed(bookingId, database);

  return { ok: true };
}

/**
 * Paid bookings nobody accepted (SPEC.md §2, §7).
 *
 * Only reachable for a tutor who has lost instant booking. Their credits went
 * into escrow when the student committed, so leaving one of these to rot would
 * hold somebody's money against an hour that is never going to happen.
 *
 * Refunded through the ordinary cancellation path, at the tutor's door: this is
 * the tutor failing to answer, so the student pays no cancellation cost.
 * Idempotent — a booking already out of `pending_tutor` is skipped.
 */
export async function expireUnacceptedBookings(
  now = new Date(),
  database: Database = defaultDb,
): Promise<{ expired: number; refundedCents: number }> {
  const stale = await database
    .select({ id: bookings.id, tutorId: bookings.tutorId })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, 'pending_tutor'),
        eq(bookings.isTrial, false),
        // The deadline is the session itself: an unanswered booking stops being
        // answerable the moment the hour arrives.
        sql`${bookings.startAtUtc} <= ${now.toISOString()}::timestamptz`,
      ),
    );

  let expired = 0;
  let refundedCents = 0;

  for (const booking of stale) {
    const result = await cancelBooking(
      { bookingId: booking.id, cancelledById: booking.tutorId },
      now,
      database,
    );

    if (result.ok) {
      expired += 1;
      refundedCents += result.refundCents;
    }
  }

  return { expired, refundedCents };
}

// ---------------------------------------------------------------------------
// Slot holds
// ---------------------------------------------------------------------------

export type HoldResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; problem: 'slot_taken' };

/**
 * Who is holding a slot: somebody with an account, or somebody who has not
 * signed up yet.
 *
 * Both are real holders. A visitor who picks a time before they have an account
 * is the *most* important person to hold a slot for — they are one form away
 * from their first booking, and "sign up and find out whether it is still
 * there" is where that stops happening.
 */
export type Holder = { studentId: string; guestToken?: never } | { guestToken: string; studentId?: never };

/**
 * Claim a slot for ten minutes while somebody signs up or buys credits.
 *
 * Re-picking a slot they already hold just extends it — the unique index on
 * (holder, tutor, slot) turns that into an update rather than a second row.
 */
export async function holdSlot(
  input: Holder & { tutorId: string; startAtUtc: Date; durationMinutes: number },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<HoldResult> {
  const mine = input.studentId
    ? eq(slotHolds.studentId, input.studentId)
    : eq(slotHolds.guestToken, input.guestToken!);

  const [otherHold] = await database
    .select({ id: slotHolds.id })
    .from(slotHolds)
    .where(
      and(
        eq(slotHolds.tutorId, input.tutorId),
        eq(slotHolds.startAtUtc, input.startAtUtc),
        gt(slotHolds.expiresAt, now),
        sql`not (${mine})`,
      ),
    )
    .limit(1);

  if (otherHold) return { ok: false, problem: 'slot_taken' };

  const expiresAt = holdExpiresAt(now);

  await database
    .insert(slotHolds)
    .values({
      studentId: input.studentId ?? null,
      guestToken: input.guestToken ?? null,
      tutorId: input.tutorId,
      startAtUtc: input.startAtUtc,
      durationMinutes: input.durationMinutes,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: input.studentId
        ? [slotHolds.studentId, slotHolds.tutorId, slotHolds.startAtUtc]
        : [slotHolds.guestToken, slotHolds.tutorId, slotHolds.startAtUtc],
      targetWhere: input.studentId
        ? sql`student_id is not null`
        : sql`guest_token is not null`,
      set: { expiresAt, durationMinutes: input.durationMinutes, createdAt: now },
    });

  return { ok: true, expiresAt };
}

/**
 * Hand a guest's holds to the account they just created.
 *
 * Called once, on the way back from signup. A hold that expired while they were
 * filling the form is simply not claimed — `expires_at > now` is still the
 * whole expiry mechanism — and one they already hold as themselves wins, which
 * is what `onConflictDoNothing` on the delete-and-move means here.
 */
export async function claimGuestHolds(
  guestToken: string,
  studentId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<number> {
  const rows = await database
    .update(slotHolds)
    .set({ studentId, guestToken: null })
    .where(
      and(
        eq(slotHolds.guestToken, guestToken),
        gt(slotHolds.expiresAt, now),
        // Not if this account already holds that slot: the unique index would
        // refuse it, and their own hold is the one to keep.
        sql`not exists (
          select 1 from slot_holds mine
          where mine.student_id = ${studentId}
            and mine.tutor_id = ${slotHolds.tutorId}
            and mine.start_at_utc = ${slotHolds.startAtUtc}
        )`,
      ),
    )
    .returning({ id: slotHolds.id });

  // Anything left under the token is a duplicate of a hold they already have.
  await database.delete(slotHolds).where(eq(slotHolds.guestToken, guestToken));

  return rows.length;
}

export type LiveHold = {
  tutorId: string;
  tutorName: string;
  startAtUtc: Date;
  durationMinutes: number;
  expiresAt: Date;
};

/**
 * This student's live holds.
 *
 * `expires_at > now` is the whole expiry mechanism: an old hold is simply not
 * returned, and nothing has to sweep the table.
 */
export async function liveHoldsFor(
  studentId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<LiveHold[]> {
  return database
    .select({
      tutorId: slotHolds.tutorId,
      tutorName: users.name,
      startAtUtc: slotHolds.startAtUtc,
      durationMinutes: slotHolds.durationMinutes,
      expiresAt: slotHolds.expiresAt,
    })
    .from(slotHolds)
    .innerJoin(users, eq(users.id, slotHolds.tutorId))
    .where(and(eq(slotHolds.studentId, studentId), gt(slotHolds.expiresAt, now)))
    .orderBy(slotHolds.expiresAt);
}

/** Slots another student is holding right now, so the calendar can grey them out. */
export async function heldSlotsFor(
  tutorId: string,
  viewerId: string | null,
  now = new Date(),
  database: DbLike = defaultDb,
  guestToken?: string | null,
): Promise<Date[]> {
  const rows = await database
    .select({ startAtUtc: slotHolds.startAtUtc })
    .from(slotHolds)
    .where(
      and(
        eq(slotHolds.tutorId, tutorId),
        gt(slotHolds.expiresAt, now),
        viewerId ? sql`${slotHolds.studentId} is distinct from ${viewerId}::uuid` : sql`true`,
        guestToken ? sql`${slotHolds.guestToken} is distinct from ${guestToken}::uuid` : sql`true`,
      ),
    );

  return rows.map((row) => row.startAtUtc);
}

export async function releaseHold(
  input: Holder & { tutorId: string; startAtUtc: Date },
  database: DbLike = defaultDb,
): Promise<void> {
  await database
    .delete(slotHolds)
    .where(
      and(
        input.studentId
          ? eq(slotHolds.studentId, input.studentId)
          : eq(slotHolds.guestToken, input.guestToken!),
        eq(slotHolds.tutorId, input.tutorId),
        eq(slotHolds.startAtUtc, input.startAtUtc),
      ),
    );
}

/**
 * The slot a guest is holding with this tutor, if any.
 *
 * The profile page reads it so a signed-out visitor's own pick is called out
 * rather than greyed out along with everybody else's.
 */
export async function guestHoldFor(
  guestToken: string,
  tutorId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<{ startAtUtc: Date; durationMinutes: number; expiresAt: Date } | null> {
  const [row] = await database
    .select({
      startAtUtc: slotHolds.startAtUtc,
      durationMinutes: slotHolds.durationMinutes,
      expiresAt: slotHolds.expiresAt,
    })
    .from(slotHolds)
    .where(
      and(
        eq(slotHolds.guestToken, guestToken),
        eq(slotHolds.tutorId, tutorId),
        gt(slotHolds.expiresAt, now),
      ),
    )
    .orderBy(slotHolds.expiresAt)
    .limit(1);

  return row ?? null;
}

// ---------------------------------------------------------------------------
// Rescheduling
// ---------------------------------------------------------------------------

export type RescheduleResult =
  | { ok: true; requestId: string; expiresAt: Date }
  | { ok: false; problem: RescheduleProblem | 'not_yours' | 'not_found' | 'slot_taken' };

/** Propose a new time. The booking does not move until the other side agrees. */
export async function requestReschedule(
  input: { bookingId: string; requestedById: string; newStartAtUtc: Date; note?: string | null },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<RescheduleResult> {
  const [booking] = await database
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      status: bookings.status,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      rescheduleCount: bookings.rescheduleCount,
      isTrial: bookings.isTrial,
    })
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);

  if (!booking) return { ok: false, problem: 'not_found' };
  if (booking.studentId !== input.requestedById && booking.tutorId !== input.requestedById) {
    return { ok: false, problem: 'not_yours' };
  }

  await expireStaleRescheduleRequests(input.bookingId, now, database);

  const [open] = await database
    .select({ id: rescheduleRequests.id })
    .from(rescheduleRequests)
    .where(
      and(eq(rescheduleRequests.bookingId, booking.id), eq(rescheduleRequests.status, 'pending')),
    )
    .limit(1);

  const problem = rescheduleProblem(booking, now, Boolean(open));
  if (problem) return { ok: false, problem };

  // The proposed time has to be free for the same duration.
  const free = await new DatabaseAvailability(database).freeSlotsFor({
    tutorId: booking.tutorId,
    durationMinutes: booking.durationMinutes,
    fromUtc: new Date(input.newStartAtUtc.getTime() - 1),
    toUtc: new Date(input.newStartAtUtc.getTime() + (booking.durationMinutes + 1) * 60_000),
    limit: 4,
  });

  if (
    !free.known ||
    !free.value.some((slot) => slot.startUtc.getTime() === input.newStartAtUtc.getTime())
  ) {
    return { ok: false, problem: 'slot_taken' };
  }

  const [created] = await database
    .insert(rescheduleRequests)
    .values({
      bookingId: booking.id,
      requestedById: input.requestedById,
      requestedBy: booking.tutorId === input.requestedById ? 'tutor' : 'student',
      newStartAtUtc: input.newStartAtUtc,
      expiresAt: rescheduleExpiresAt(now, input.newStartAtUtc),
      note: input.note?.slice(0, 300) ?? null,
    })
    .returning({ id: rescheduleRequests.id, expiresAt: rescheduleRequests.expiresAt });

  return { ok: true, requestId: created!.id, expiresAt: created!.expiresAt };
}

/**
 * Expire unanswered requests, when they are read.
 *
 * Same reasoning as trial requests: a sweeper leaves a window in which someone
 * can accept a request that should already be dead.
 */
export async function expireStaleRescheduleRequests(
  bookingId: string | null,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<number> {
  const rows = await database
    .select({
      id: rescheduleRequests.id,
      createdAt: rescheduleRequests.createdAt,
      newStartAtUtc: rescheduleRequests.newStartAtUtc,
    })
    .from(rescheduleRequests)
    .where(
      bookingId
        ? and(eq(rescheduleRequests.bookingId, bookingId), eq(rescheduleRequests.status, 'pending'))
        : eq(rescheduleRequests.status, 'pending'),
    );

  const dead = rows.filter((row) =>
    isRescheduleExpired({ requestedAt: row.createdAt, newStartAtUtc: row.newStartAtUtc }, now),
  );

  for (const row of dead) {
    await database
      .update(rescheduleRequests)
      .set({ status: 'expired', respondedAt: now })
      .where(eq(rescheduleRequests.id, row.id));
  }

  return dead.length;
}

export type RescheduleDecisionResult =
  | { ok: true; newStartAtUtc: Date }
  | { ok: false; problem: 'not_found' | 'not_yours' | 'expired' | 'slot_taken' | 'answered' };

/**
 * Accept or decline a proposed time.
 *
 * Accepting moves the booking inside a serializable transaction, for the same
 * reason creating one is: the new slot has to still be free at the moment it is
 * taken, and `booking_no_overlap` is what proves it.
 */
export async function decideReschedule(
  input: { requestId: string; deciderId: string; accept: boolean },
  now = new Date(),
  database: Database = defaultDb,
): Promise<RescheduleDecisionResult> {
  const [request] = await database
    .select({
      id: rescheduleRequests.id,
      bookingId: rescheduleRequests.bookingId,
      requestedById: rescheduleRequests.requestedById,
      newStartAtUtc: rescheduleRequests.newStartAtUtc,
      status: rescheduleRequests.status,
      createdAt: rescheduleRequests.createdAt,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      bookingStatus: bookings.status,
    })
    .from(rescheduleRequests)
    .innerJoin(bookings, eq(bookings.id, rescheduleRequests.bookingId))
    .where(eq(rescheduleRequests.id, input.requestId))
    .limit(1);

  if (!request) return { ok: false, problem: 'not_found' };
  if (request.status !== 'pending') return { ok: false, problem: 'answered' };

  // Only the *other* side may answer.
  const isParticipant =
    request.studentId === input.deciderId || request.tutorId === input.deciderId;
  if (!isParticipant || request.requestedById === input.deciderId) {
    return { ok: false, problem: 'not_yours' };
  }

  if (isRescheduleExpired({ requestedAt: request.createdAt, newStartAtUtc: request.newStartAtUtc }, now)) {
    await database
      .update(rescheduleRequests)
      .set({ status: 'expired', respondedAt: now })
      .where(eq(rescheduleRequests.id, request.id));
    return { ok: false, problem: 'expired' };
  }

  if (!input.accept) {
    await database
      .update(rescheduleRequests)
      .set({ status: 'declined', respondedAt: now })
      .where(eq(rescheduleRequests.id, request.id));
    return { ok: true, newStartAtUtc: request.newStartAtUtc };
  }

  try {
    return await database.transaction(
      async (tx) => {
        await tx
          .update(bookings)
          .set({
            startAtUtc: request.newStartAtUtc,
            rescheduleCount: sql`${bookings.rescheduleCount} + 1`,
            updatedAt: now,
          })
          .where(eq(bookings.id, request.bookingId));

        await tx
          .update(rescheduleRequests)
          .set({ status: 'accepted', respondedAt: now })
          .where(eq(rescheduleRequests.id, request.id));

        return { ok: true as const, newStartAtUtc: request.newStartAtUtc };
      },
      { isolationLevel: 'serializable' },
    );
  } catch (error) {
    if (isRaceLoss(error)) return { ok: false, problem: 'slot_taken' };
    throw error;
  }
}

export type OpenReschedule = {
  id: string;
  bookingId: string;
  requestedById: string;
  requestedBy: string;
  newStartAtUtc: Date;
  expiresAt: Date;
  note: string | null;
  otherName: string;
  originalStartAtUtc: Date;
  durationMinutes: number;
};

/** Open reschedule requests either side of this person's bookings. */
export async function openReschedulesFor(
  userId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<OpenReschedule[]> {
  await expireStaleRescheduleRequests(null, now, database);

  const rows = await database
    .select({
      id: rescheduleRequests.id,
      bookingId: rescheduleRequests.bookingId,
      requestedById: rescheduleRequests.requestedById,
      requestedBy: rescheduleRequests.requestedBy,
      newStartAtUtc: rescheduleRequests.newStartAtUtc,
      expiresAt: rescheduleRequests.expiresAt,
      note: rescheduleRequests.note,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      originalStartAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      studentName: sql<string>`student.name`,
      tutorName: sql<string>`tutor.name`,
    })
    .from(rescheduleRequests)
    .innerJoin(bookings, eq(bookings.id, rescheduleRequests.bookingId))
    .innerJoin(sql`users as student`, sql`student.id = ${bookings.studentId}`)
    .innerJoin(sql`users as tutor`, sql`tutor.id = ${bookings.tutorId}`)
    .where(
      and(
        eq(rescheduleRequests.status, 'pending'),
        sql`(${bookings.studentId} = ${userId} or ${bookings.tutorId} = ${userId})`,
      ),
    )
    .orderBy(desc(rescheduleRequests.createdAt));

  return rows.map((row) => ({
    id: row.id,
    bookingId: row.bookingId,
    requestedById: row.requestedById,
    requestedBy: row.requestedBy,
    newStartAtUtc: row.newStartAtUtc,
    expiresAt: row.expiresAt,
    note: row.note,
    otherName: row.tutorId === userId ? row.studentName : row.tutorName,
    originalStartAtUtc: row.originalStartAtUtc,
    durationMinutes: row.durationMinutes,
  }));
}

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

export type CancelResult =
  | { ok: true; refundCents: number }
  | { ok: false; problem: 'not_found' | 'not_yours' | 'not_cancellable' };

/**
 * Cancel a booking, and settle it immediately.
 *
 * The refund follows `resolveBookingOutcome` — the same function every other
 * ending goes through — so the 24-hour and 2-hour boundaries live in one place
 * and the copy the student was shown beforehand cannot drift from what happens.
 */
export async function cancelBooking(
  input: { bookingId: string; cancelledById: string },
  now = new Date(),
  database: Database = defaultDb,
): Promise<CancelResult> {
  const { resolveBookingOutcome } = await import('@/lib/money/outcomes');
  const { pendingToAvailableEntries } = await import('@/lib/money/ledger');

  const [booking] = await database
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      status: bookings.status,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      commissionBps: bookings.commissionBps,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
    })
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);

  if (!booking) return { ok: false, problem: 'not_found' };

  const by =
    booking.studentId === input.cancelledById
      ? 'student'
      : booking.tutorId === input.cancelledById
        ? 'tutor'
        : null;

  if (!by) return { ok: false, problem: 'not_yours' };
  if (!['pending_tutor', 'confirmed'].includes(booking.status)) {
    return { ok: false, problem: 'not_cancellable' };
  }

  const outcome = resolveBookingOutcome(booking, { kind: 'cancellation', by, atUtc: now });

  await database.transaction(async (tx) => {
    await appendLedger(tx, { entries: outcome.entries, external: false });

    if (outcome.tutorCents > 0) {
      await appendLedger(
        tx,
        pendingToAvailableEntries({
          bookingId: booking.id,
          tutorId: booking.tutorId,
          amountCents: outcome.tutorCents,
        }),
      );
    }

    await moveBookingStatus(
      booking.id,
      outcome.terminalStatus,
      { cancelledAt: now, cancelledBy: by, settledAt: now },
      tx,
    );

    if (outcome.tutorStrike) {
      await tx
        .update(tutorProfiles)
        .set({ strikes: sql`${tutorProfiles.strikes} + 1`, updatedAt: now })
        .where(eq(tutorProfiles.userId, booking.tutorId));
    }
  });

  await emailBookingCancelled(
    {
      bookingId: booking.id,
      cancelledBy: by,
      refundCents: outcome.refundCents,
      // What the other side kept. The template never recomputes a tier — it is
      // handed the numbers the ledger actually moved.
      retainedCents: booking.priceCents - outcome.refundCents,
    },
    database,
  );

  return { ok: true, refundCents: outcome.refundCents };
}
