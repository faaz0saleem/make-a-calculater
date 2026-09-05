/**
 * `resolveBookingOutcome` — the single function that decides what a finished or
 * abandoned booking does to everyone's money (SPEC.md §2, cancellation table).
 *
 * It is pure. It takes the booking as it was priced and what actually happened,
 * and returns the ledger entries plus the non-money consequences (a tutor strike,
 * a free-session credit). Nothing else in the codebase is allowed to decide a
 * refund percentage.
 *
 * The whole policy table reduces to one number — `refundCents`. Everything the
 * tutor and the platform get is the remainder, split by the commission that was
 * snapshotted onto the booking:
 *
 *     chargeable = price - refund
 *     platform   = floor(chargeable * commission_bps / 10000)
 *     tutor      = chargeable - platform
 *
 * That is why "50% refund / tutor keeps 50% of their share" needs no special
 * case: halving the chargeable amount halves both shares.
 *
 * There is exactly one exception, and it is deliberate. When a session fails on
 * the connection, **the platform absorbs it**: the student is refunded in full
 * *and* the tutor is paid their full share, out of platform revenue. Both of
 * them did nothing wrong and neither should pay for our transport failing. That
 * cannot be expressed as a refund percentage — the chargeable amount is zero
 * and the tutor is still paid — so it is the one branch that computes its own
 * entries. It is capped per student (see `MAX_ABSORBED_FAILURES_PER_STUDENT`),
 * because "my connection broke" is also the easiest free lesson to claim.
 */

import type { BookingStatus } from '@/lib/bookings/status';
import { assertInt, assertNonNegativeInt, divRoundHalfUp, MoneyError } from './cents';
import { assertBalanced, assertUniqueKeys, type LedgerEntryDraft } from './ledger';
import { applyCommission } from './pricing';

/** Minutes before start at which the student's refund drops from 100% to 50%. */
export const FULL_REFUND_CUTOFF_MINUTES = 24 * 60;
/** Minutes before start at which the refund drops from 50% to nothing. */
export const PARTIAL_REFUND_CUTOFF_MINUTES = 2 * 60;
/** How long a tutor must wait in the room before a student counts as a no-show. */
export const NO_SHOW_WAIT_SECONDS = 10 * 60;
/** Share of the booked duration both parties must overlap for a session to count. */
export const MIN_ATTENDANCE_BPS = 5_000; // 50%

/**
 * How many connection failures the platform will absorb for one student before
 * it stops, and over what window.
 *
 * Past the cap the outcome falls back to the plain refund: the student still
 * gets every cent back, but the tutor is not paid out of our revenue for the
 * third failed session in three months with the same person.
 */
export const MAX_ABSORBED_FAILURES_PER_STUDENT = 2;
export const ABSORBED_FAILURE_WINDOW_DAYS = 90;

/** Whether this student's next technical failure is still on us. */
export function platformAbsorbsFailure(absorbedInWindow: number): boolean {
  assertNonNegativeInt(absorbedInWindow, 'absorbedInWindow');
  return absorbedInWindow < MAX_ABSORBED_FAILURES_PER_STUDENT;
}

export type BookingForOutcome = {
  id: string;
  studentId: string;
  tutorId: string;
  isTrial: boolean;
  /** Snapshotted at booking creation. */
  priceCents: number;
  /** Snapshotted at booking creation. */
  commissionBps: number;
  startAtUtc: Date;
  durationMinutes: number;
  /**
   * Stamped when the session was closed as having happened — both people
   * present for at least half of it (SPEC.md §7). Once set, it is the record
   * that the lesson took place.
   */
  completedAt?: Date | null;
};

/**
 * What actually happened. Either somebody cancelled before the session, or the
 * session ran and LiveKit webhooks told us who was in the room and for how long.
 *
 * These seconds come from `session_events` only. The client never reports them.
 */
export type Attendance =
  | { kind: 'cancellation'; by: 'student' | 'tutor'; atUtc: Date }
  | {
      kind: 'session';
      studentSeconds: number;
      tutorSeconds: number;
      /** Seconds both parties were in the room at the same time. */
      bothPresentSeconds: number;
      /** Seconds the tutor sat in the room with nobody else there. */
      tutorWaitedAloneSeconds: number;
    };

export type BookingResolution =
  | 'completed'
  | 'cancelled_by_student'
  | 'cancelled_by_tutor'
  | 'no_show_student'
  | 'no_show_tutor'
  | 'technical_failure';

export type OutcomeOptions = {
  /**
   * Whether the platform pays the tutor for a technical failure out of its own
   * revenue. Decided by the caller, because the cap is a count of that
   * student's recent failures and this function does not read the database.
   * Left out, it is false — the older, stricter behaviour.
   */
  absorbFailure?: boolean;
};

export type BookingOutcome = {
  resolution: BookingResolution;
  /** Where the state machine should move the booking. */
  terminalStatus: BookingStatus;
  refundCents: number;
  chargeableCents: number;
  tutorCents: number;
  platformCents: number;
  /** The tutor gets a strike: 3 in 90 days triggers a review. */
  tutorStrike: boolean;
  /** True when the platform paid the tutor for a session it did not charge for. */
  platformAbsorbed: boolean;
  /** The student is owed one free session (tutor no-show). */
  freeSessionCredit: boolean;
  /** Human-readable reason, stored on the ledger rows and shown in admin. */
  reason: string;
  entries: LedgerEntryDraft[];
};

const TERMINAL_STATUS_BY_RESOLUTION: Record<BookingResolution, BookingStatus> = {
  completed: 'settled',
  cancelled_by_student: 'cancelled_by_student',
  cancelled_by_tutor: 'cancelled_by_tutor',
  no_show_student: 'settled',
  no_show_tutor: 'refunded',
  technical_failure: 'refunded',
};

/** Whole minutes between the cancellation and the session start. Negative if late. */
export function minutesBeforeStart(startAtUtc: Date, atUtc: Date): number {
  return Math.floor((startAtUtc.getTime() - atUtc.getTime()) / 60_000);
}

/**
 * Classify what happened, without touching money. Split out so the routing rules
 * can be read and tested on their own.
 */
export function classifyOutcome(booking: BookingForOutcome, attendance: Attendance): BookingResolution {
  if (attendance.kind === 'cancellation') {
    return attendance.by === 'student' ? 'cancelled_by_student' : 'cancelled_by_tutor';
  }

  const {
    studentSeconds,
    tutorSeconds,
    bothPresentSeconds,
    tutorWaitedAloneSeconds,
  } = attendance;

  assertNonNegativeInt(studentSeconds, 'studentSeconds');
  assertNonNegativeInt(tutorSeconds, 'tutorSeconds');
  assertNonNegativeInt(bothPresentSeconds, 'bothPresentSeconds');
  assertNonNegativeInt(tutorWaitedAloneSeconds, 'tutorWaitedAloneSeconds');

  // Already closed as having happened. `completed_at` is only ever stamped by
  // this same classifier agreeing, at the time, that both people were there for
  // half the session — so a later reading that says otherwise means the events
  // are incomplete, not that the lesson stopped having happened. Trusting the
  // stamp is what stops a tutor losing a session's pay, and taking a strike,
  // because a webhook went missing afterwards.
  if (booking.completedAt) return 'completed';

  // The tutor never showed up. This is on the tutor whatever the student did.
  if (tutorSeconds === 0) return 'no_show_tutor';

  // The tutor showed up and the student never did. It only counts as a student
  // no-show if the tutor actually waited the full ten minutes.
  if (studentSeconds === 0) {
    return tutorWaitedAloneSeconds >= NO_SHOW_WAIT_SECONDS ? 'no_show_student' : 'technical_failure';
  }

  const requiredSeconds = requiredOverlapSeconds(booking.durationMinutes);
  return bothPresentSeconds >= requiredSeconds ? 'completed' : 'technical_failure';
}

/**
 * An admin resolving a dispute in the student's favour (SPEC.md §10).
 *
 * Not derived from attendance — that is the point of a dispute: a human looked
 * at it and decided. It still comes from this module, because the rule is that
 * nothing outside here builds a ledger entry that moves a refund.
 *
 * The tutor is paid nothing and takes no strike: a dispute upheld is not the
 * same as a no-show, and if it were, the tutor would be able to appeal a strike
 * they never earned.
 */
export function adminRefundOutcome(booking: BookingForOutcome): BookingOutcome {
  assertNonNegativeInt(booking.priceCents, 'priceCents');

  const outcome: BookingOutcome = {
    resolution: 'technical_failure',
    terminalStatus: 'refunded',
    refundCents: booking.priceCents,
    chargeableCents: 0,
    tutorCents: 0,
    platformCents: 0,
    tutorStrike: false,
    freeSessionCredit: false,
    platformAbsorbed: false,
    reason: 'dispute_refund',
    entries: [],
  };

  if (booking.isTrial || booking.priceCents === 0) return outcome;

  const entries: LedgerEntryDraft[] = [
    {
      account: 'escrow',
      ownerId: booking.studentId,
      deltaCents: -booking.priceCents,
      reason: 'dispute_refund',
      idempotencyKey: `booking:${booking.id}:settle:escrow`,
      bookingId: booking.id,
    },
    {
      account: 'student_credits',
      ownerId: booking.studentId,
      deltaCents: booking.priceCents,
      reason: 'dispute_refund:refund',
      idempotencyKey: `booking:${booking.id}:settle:refund`,
      bookingId: booking.id,
    },
  ];

  assertUniqueKeys(entries);
  assertBalanced(entries, `dispute refund for booking ${booking.id}`);
  outcome.entries = entries;
  return outcome;
}

/** Seconds of overlap needed for a session to auto-complete. */
export function requiredOverlapSeconds(durationMinutes: number): number {
  assertNonNegativeInt(durationMinutes, 'durationMinutes');
  return divRoundHalfUp(durationMinutes * 60 * MIN_ATTENDANCE_BPS, 10_000);
}

/** The student's refund for a given resolution, in cents. */
export function refundForResolution(
  booking: BookingForOutcome,
  resolution: BookingResolution,
  attendance: Attendance,
): number {
  switch (resolution) {
    case 'completed':
      return 0;

    case 'no_show_student':
      // Tutor turned up and waited. The student pays in full.
      return 0;

    case 'cancelled_by_tutor':
    case 'no_show_tutor':
    case 'technical_failure':
      return booking.priceCents;

    case 'cancelled_by_student': {
      if (attendance.kind !== 'cancellation') {
        throw new MoneyError('cancelled_by_student requires a cancellation attendance record');
      }
      const notice = minutesBeforeStart(booking.startAtUtc, attendance.atUtc);
      if (notice > FULL_REFUND_CUTOFF_MINUTES) return booking.priceCents;
      if (notice >= PARTIAL_REFUND_CUTOFF_MINUTES) return divRoundHalfUp(booking.priceCents, 2);
      return 0;
    }
  }
}

/**
 * An absorbed failure: the tutor is paid exactly what a completed session would
 * have paid them, and the platform's share of that is negative — we are the
 * ones paying it.
 */
function absorbedSplit(booking: BookingForOutcome): { tutorCents: number; platformCents: number } {
  const { tutorCents } = applyCommission(booking.priceCents, booking.commissionBps);
  return { tutorCents, platformCents: -tutorCents };
}

const REASONS: Record<BookingResolution, string> = {
  completed: 'session_completed',
  cancelled_by_student: 'cancelled_by_student',
  cancelled_by_tutor: 'cancelled_by_tutor',
  no_show_student: 'no_show_student',
  no_show_tutor: 'no_show_tutor',
  technical_failure: 'technical_failure',
};

/**
 * Resolve a booking into ledger entries.
 *
 * The returned entries always net to zero: escrow is emptied and the same cents
 * reappear across the student's wallet, the tutor's pending balance and platform
 * revenue.
 */
export function resolveBookingOutcome(
  booking: BookingForOutcome,
  attendance: Attendance,
  options: OutcomeOptions = {},
): BookingOutcome {
  assertNonNegativeInt(booking.priceCents, 'priceCents');
  assertNonNegativeInt(booking.commissionBps, 'commissionBps');
  assertInt(booking.durationMinutes, 'durationMinutes');

  if (booking.isTrial && booking.priceCents !== 0) {
    throw new MoneyError(`trial booking ${booking.id} must be priced at zero, got ${booking.priceCents}`);
  }

  const resolution = classifyOutcome(booking, attendance);
  const refundCents = refundForResolution(booking, resolution, attendance);
  const chargeableCents = booking.priceCents - refundCents;

  // The one branch that does not follow from the refund: a connection failure
  // we are absorbing pays the tutor what a completed session would have, and
  // takes it out of platform revenue rather than out of the student.
  const absorbed = resolution === 'technical_failure' && options.absorbFailure === true;
  const { tutorCents, platformCents } = absorbed
    ? absorbedSplit(booking)
    : applyCommission(chargeableCents, booking.commissionBps);

  const outcome: BookingOutcome = {
    resolution,
    terminalStatus: TERMINAL_STATUS_BY_RESOLUTION[resolution],
    refundCents,
    chargeableCents,
    tutorCents,
    platformCents,
    tutorStrike: resolution === 'cancelled_by_tutor' || resolution === 'no_show_tutor',
    freeSessionCredit: resolution === 'no_show_tutor',
    platformAbsorbed: absorbed,
    reason: absorbed ? 'technical_failure_absorbed' : REASONS[resolution],
    entries: [],
  };

  // Trials move no money and have no escrow row, so there is nothing to settle.
  if (booking.isTrial || booking.priceCents === 0) {
    return outcome;
  }

  const entries: LedgerEntryDraft[] = [
    {
      account: 'escrow',
      ownerId: booking.studentId,
      deltaCents: -booking.priceCents,
      reason: outcome.reason,
      idempotencyKey: `booking:${booking.id}:settle:escrow`,
      bookingId: booking.id,
    },
  ];

  if (refundCents > 0) {
    entries.push({
      account: 'student_credits',
      ownerId: booking.studentId,
      deltaCents: refundCents,
      reason: `${outcome.reason}:refund`,
      idempotencyKey: `booking:${booking.id}:settle:refund`,
      bookingId: booking.id,
    });
  }

  if (tutorCents > 0) {
    entries.push({
      account: 'tutor_pending',
      ownerId: booking.tutorId,
      deltaCents: tutorCents,
      reason: `${outcome.reason}:tutor_share`,
      idempotencyKey: `booking:${booking.id}:settle:tutor`,
      bookingId: booking.id,
    });
  }

  if (platformCents !== 0) {
    entries.push({
      account: 'platform_revenue',
      ownerId: null,
      deltaCents: platformCents,
      // Negative when we are absorbing: revenue paying for a session nobody was
      // charged for. Naming it differently keeps that visible in the ledger.
      reason: absorbed ? `${outcome.reason}:absorbed` : `${outcome.reason}:commission`,
      idempotencyKey: `booking:${booking.id}:settle:platform`,
      bookingId: booking.id,
    });
  }

  assertUniqueKeys(entries);
  assertBalanced(entries, `settlement for booking ${booking.id}`);

  outcome.entries = entries;
  return outcome;
}
