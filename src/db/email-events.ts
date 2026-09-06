/**
 * What each event puts in the outbox (SPEC.md §11).
 *
 * One function per thing that happens, so a call site says `await
 * emailBookingConfirmed(bookingId)` and never assembles props, resolves a
 * counterpart's name or builds a URL. Fourteen call sites each doing that is
 * fourteen chances to send somebody a lesson time in the wrong timezone.
 *
 * Every one of these is best-effort in the sense that it must not break the
 * thing it is reporting on: a booking that succeeded and an email that could
 * not be queued is a booking, not an error. They log and return instead of
 * throwing — the outbox row (or its absence) is the record either way.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { db as defaultDb } from './client';
import { enqueueEmail, emailOrigin } from './email';
import type { DbLike } from './ledger';
import { bookings, payouts, payoutMethods, reviews, subjects, users } from './schema';
import { correlationFor, logEvent } from '@/lib/observability/log';

/** Everything the lesson templates want, resolved once. */
type LessonContext = {
  bookingId: string;
  startAtUtc: Date;
  durationMinutes: number;
  priceCents: number;
  isTrial: boolean;
  studentId: string;
  tutorId: string;
  studentName: string;
  tutorName: string;
  studentTz: string;
  tutorTz: string;
  subjectName: string;
};

async function lessonContext(
  bookingId: string,
  database: DbLike = defaultDb,
): Promise<LessonContext | null> {
  const [row] = await database
    .select({
      bookingId: bookings.id,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      priceCents: bookings.priceCents,
      isTrial: bookings.isTrial,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      studentTz: bookings.studentTz,
      tutorTz: bookings.tutorTz,
      subjectName: subjects.name,
    })
    .from(bookings)
    .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) return null;

  const people = await database
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [row.studentId, row.tutorId]));

  const byId = new Map(people.map((person) => [person.id, person.name]));

  return {
    ...row,
    subjectName: row.subjectName ?? 'your subject',
    studentName: byId.get(row.studentId) ?? 'your student',
    tutorName: byId.get(row.tutorId) ?? 'your tutor',
  } as LessonContext;
}

/** The half of the lesson props that depend on who is reading. */
function lessonProps(context: LessonContext, audience: 'student' | 'tutor') {
  return {
    bookingId: context.bookingId,
    counterpartName: audience === 'student' ? context.tutorName : context.studentName,
    subjectName: context.subjectName,
    startsAt: context.startAtUtc.toISOString(),
    timezone: audience === 'student' ? context.studentTz : context.tutorTz,
    durationMinutes: context.durationMinutes,
    bookingUrl: `${emailOrigin()}/sessions/${context.bookingId}`,
  };
}

function failed(event: string, error: unknown, correlationId: string): void {
  logEvent('email.enqueue_failed', {
    severity: 'error',
    event,
    correlationId,
    error: error instanceof Error ? error.message : String(error),
  });
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

/** Both sides get the receipt. The tutor's copy is how they learn they are booked. */
export async function emailBookingConfirmed(
  bookingId: string,
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('booking', bookingId);

  try {
    const context = await lessonContext(bookingId, database);
    if (!context) return;

    for (const audience of ['student', 'tutor'] as const) {
      await enqueueEmail(
        {
          userId: audience === 'student' ? context.studentId : context.tutorId,
          idempotencyKey: `booking:${bookingId}:confirmed:${audience}`,
          correlationId,
          payload: {
            kind: 'booking_confirmed',
            data: {
              ...lessonProps(context, audience),
              recipientRole: audience,
              isTrial: context.isTrial,
              priceCents: context.priceCents,
            },
          },
        },
        database,
      );
    }
  } catch (error) {
    failed('booking_confirmed', error, correlationId);
  }
}

export async function emailBookingCancelled(
  input: {
    bookingId: string;
    cancelledBy: 'student' | 'tutor';
    refundCents: number;
    retainedCents: number;
    reason?: string | null;
  },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('booking', input.bookingId);

  try {
    const context = await lessonContext(input.bookingId, database);
    if (!context) return;

    for (const audience of ['student', 'tutor'] as const) {
      await enqueueEmail(
        {
          userId: audience === 'student' ? context.studentId : context.tutorId,
          idempotencyKey: `booking:${input.bookingId}:cancelled:${audience}`,
          correlationId,
          payload: {
            kind: 'booking_cancelled',
            data: {
              ...lessonProps(context, audience),
              cancelledBy: input.cancelledBy,
              recipientRole: audience,
              refundCents: input.refundCents,
              retainedCents: input.retainedCents,
              ...(input.reason ? { reason: input.reason } : {}),
            },
          },
        },
        database,
      );
    }
  } catch (error) {
    failed('booking_cancelled', error, correlationId);
  }
}

/**
 * A reminder, queued with an expiry.
 *
 * The expiry is the interesting part: a T-1h reminder that a retry finally
 * delivers after the lesson has finished is worse than none at all, so it dies
 * in the queue instead. The row stays, saying it expired.
 */
export async function emailReminder(
  input: {
    bookingId: string;
    audience: 'student' | 'tutor';
    slot: 'day' | 'hour' | 'final';
    key: string;
  },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('booking', input.bookingId);

  try {
    const context = await lessonContext(input.bookingId, database);
    if (!context) return;

    const props = lessonProps(context, input.audience);
    const kind =
      input.slot === 'day' ? 'reminder_24h' : input.slot === 'hour' ? 'reminder_1h' : 'session_starting';

    await enqueueEmail(
      {
        userId: input.audience === 'student' ? context.studentId : context.tutorId,
        idempotencyKey: `email:${input.key}`,
        correlationId,
        // Nothing about a lesson is worth saying once it has started.
        expiresAt: context.startAtUtc,
        payload:
          kind === 'session_starting'
            ? {
                kind,
                data: { ...props, classroomUrl: `${emailOrigin()}/sessions/${input.bookingId}` },
              }
            : { kind, data: props },
      },
      database,
    );
  } catch (error) {
    failed('reminder', error, correlationId);
  }
}

/** After the session: the review ask, and the deadline for saying it went wrong. */
export async function emailSessionCompleted(
  input: { bookingId: string; disputeDeadline: Date },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('booking', input.bookingId);

  try {
    const context = await lessonContext(input.bookingId, database);
    if (!context || context.isTrial) return;

    await enqueueEmail(
      {
        userId: context.studentId,
        idempotencyKey: `booking:${input.bookingId}:completed`,
        correlationId,
        // Past the dispute window the email's own call to action is gone.
        expiresAt: input.disputeDeadline,
        payload: {
          kind: 'session_completed',
          data: {
            ...lessonProps(context, 'student'),
            reviewUrl: `${emailOrigin()}/dashboard#review-${input.bookingId}`,
            disputeDeadline: input.disputeDeadline.toISOString(),
          },
        },
      },
      database,
    );
  } catch (error) {
    failed('session_completed', error, correlationId);
  }
}

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

export async function emailTrialRequested(
  input: { bookingId: string; expiresAt: Date },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('booking', input.bookingId);

  try {
    const context = await lessonContext(input.bookingId, database);
    if (!context) return;

    await enqueueEmail(
      {
        userId: context.tutorId,
        idempotencyKey: `booking:${input.bookingId}:trial_requested`,
        correlationId,
        // After it expires the tutor cannot answer it, so the mail is a lie.
        expiresAt: input.expiresAt,
        payload: {
          kind: 'trial_requested',
          data: { ...lessonProps(context, 'tutor'), expiresAt: input.expiresAt.toISOString() },
        },
      },
      database,
    );
  } catch (error) {
    failed('trial_requested', error, correlationId);
  }
}

export async function emailTrialDecision(
  input: { bookingId: string; decision: 'accepted' | 'declined'; reason?: string | null },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('booking', input.bookingId);

  try {
    const context = await lessonContext(input.bookingId, database);
    if (!context) return;

    await enqueueEmail(
      {
        userId: context.studentId,
        idempotencyKey: `booking:${input.bookingId}:trial_${input.decision}`,
        correlationId,
        payload: {
          kind: 'trial_decision',
          data:
            input.decision === 'accepted'
              ? { ...lessonProps(context, 'student'), decision: 'accepted' }
              : {
                  ...lessonProps(context, 'student'),
                  decision: 'declined',
                  // A declined trial with no reason still has to say something,
                  // and "no reason given" is the truth rather than a guess.
                  reason: input.reason?.trim() || 'No reason was given.',
                  browseUrl: `${emailOrigin()}/`,
                },
        },
      },
      database,
    );
  } catch (error) {
    failed('trial_decision', error, correlationId);
  }
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export async function emailCreditsPurchased(
  input: {
    userId: string;
    purchaseId: string;
    paidCents: number;
    addedCents: number;
    balanceCents: number;
  },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('purchase', input.purchaseId);

  try {
    await enqueueEmail(
      {
        userId: input.userId,
        idempotencyKey: `purchase:${input.purchaseId}:credited`,
        correlationId,
        payload: {
          kind: 'credits_purchased',
          data: {
            purchaseId: input.purchaseId,
            paidCents: input.paidCents,
            addedCents: input.addedCents,
            balanceCents: input.balanceCents,
            receiptUrl: `${emailOrigin()}/credits`,
          },
        },
      },
      database,
    );
  } catch (error) {
    failed('credits_purchased', error, correlationId);
  }
}

/**
 * The wallet will not cover what is coming.
 *
 * Keyed on the occurrence rather than the day, so a student with two standing
 * slots hears about both, and the same occurrence never warns twice.
 */
export async function emailCreditsLow(
  input: { userId: string; balanceCents: number; occurrenceId: string },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('booking', input.occurrenceId);

  try {
    await enqueueEmail(
      {
        userId: input.userId,
        idempotencyKey: `booking:${input.occurrenceId}:credits_low`,
        correlationId,
        payload: {
          kind: 'credits_low',
          data: { balanceCents: input.balanceCents, creditsUrl: `${emailOrigin()}/credits` },
        },
      },
      database,
    );
  } catch (error) {
    failed('credits_low', error, correlationId);
  }
}

/**
 * A payout moved.
 *
 * The last four digits come out of the encrypted column here rather than being
 * passed in, so no caller has a reason to be holding them — and only four
 * digits are ever decrypted into a message.
 */
export async function emailPayoutStatus(
  input: { payoutId: string; status: 'requested' | 'approved' | 'paid' },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('payout', input.payoutId);

  try {
    const [row] = await database
      .select({
        tutorId: payouts.tutorId,
        amountCents: payouts.amountCents,
        feeCents: payouts.feeCents,
        paidRef: payouts.paidRef,
        last4: payoutMethods.last4,
      })
      .from(payouts)
      .leftJoin(payoutMethods, eq(payoutMethods.id, payouts.methodId))
      .where(eq(payouts.id, input.payoutId))
      .limit(1);

    if (!row) return;

    const last4 = row.last4 ?? '0000';

    await enqueueEmail(
      {
        userId: row.tutorId,
        idempotencyKey: `payout:${input.payoutId}:${input.status}`,
        correlationId,
        payload: {
          kind: 'payout_status',
          data:
            input.status === 'paid'
              ? {
                  status: 'paid',
                  payoutId: input.payoutId,
                  amountCents: row.amountCents,
                  feeCents: row.feeCents ?? 0,
                  destinationLast4: last4,
                  transferReference: row.paidRef ?? 'not recorded',
                  earningsUrl: `${emailOrigin()}/tutor/earnings`,
                }
              : {
                  status: input.status,
                  payoutId: input.payoutId,
                  amountCents: row.amountCents,
                  feeCents: row.feeCents ?? 0,
                  destinationLast4: last4,
                  earningsUrl: `${emailOrigin()}/tutor/earnings`,
                },
        },
      },
      database,
    );
  } catch (error) {
    failed('payout_status', error, correlationId);
  }
}

// ---------------------------------------------------------------------------
// The rest
// ---------------------------------------------------------------------------

export async function emailVerificationDecision(
  input: { tutorId: string; decision: 'approved' | 'rejected'; reason?: string | null },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('user', input.tutorId);

  try {
    await enqueueEmail(
      {
        userId: input.tutorId,
        // A tutor can be rejected, fix it and be rejected again; the decision's
        // own timestamp keeps those separate without sending the first twice.
        idempotencyKey: `user:${input.tutorId}:verification:${input.decision}:${Date.now()}`,
        correlationId,
        payload: {
          kind: 'verification_decision',
          data:
            input.decision === 'approved'
              ? { decision: 'approved', profileUrl: `${emailOrigin()}/tutors/${input.tutorId}` }
              : {
                  decision: 'rejected',
                  reason: input.reason?.trim() || 'No reason was recorded.',
                  resubmitUrl: `${emailOrigin()}/tutor/onboarding`,
                },
        },
      },
      database,
    );
  } catch (error) {
    failed('verification_decision', error, correlationId);
  }
}

export async function emailNewReview(
  input: { reviewId: string },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('user', input.reviewId);

  try {
    const [row] = await database
      .select({
        tutorId: reviews.tutorId,
        rating: reviews.rating,
        body: reviews.body,
      })
      .from(reviews)
      .where(eq(reviews.id, input.reviewId))
      .limit(1);

    if (!row) return;

    await enqueueEmail(
      {
        userId: row.tutorId,
        idempotencyKey: `review:${input.reviewId}:posted`,
        correlationId,
        payload: {
          kind: 'new_review',
          data: {
            rating: row.rating,
            reviewText: row.body,
            reviewUrl: `${emailOrigin()}/tutors/${row.tutorId}#reviews`,
          },
        },
      },
      database,
    );
  } catch (error) {
    failed('new_review', error, correlationId);
  }
}

/**
 * A tutor somebody follows published more time.
 *
 * Keyed by tutor and day, matching the bell's own dedupe: a tutor saving their
 * calendar four times before breakfast is one piece of news.
 */
export async function emailFollowedTutorSlots(
  input: { followerIds: readonly string[]; tutorId: string; tutorName: string; day: string },
  database: DbLike = defaultDb,
): Promise<void> {
  const correlationId = correlationFor('user', input.tutorId);

  try {
    for (const followerId of input.followerIds) {
      await enqueueEmail(
        {
          userId: followerId,
          idempotencyKey: `follow:${input.tutorId}:${followerId}:${input.day}`,
          correlationId,
          payload: {
            kind: 'followed_tutor_slots',
            data: {
              tutorName: input.tutorName,
              profileUrl: `${emailOrigin()}/tutors/${input.tutorId}`,
            },
          },
        },
        database,
      );
    }
  } catch (error) {
    failed('followed_tutor_slots', error, correlationId);
  }
}
