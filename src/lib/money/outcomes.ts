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
  const { tutorCents, platformCents } = applyCommission(chargeableCents, booking.commissionBps);

  const outcome: BookingOutcome = {
    resolution,
    terminalStatus: TERMINAL_STATUS_BY_RESOLUTION[resolution],
    refundCents,
    chargeableCents,
    tutorCents,
    platformCents,
    tutorStrike: resolution === 'cancelled_by_tutor' || resolution === 'no_show_tutor',
    freeSessionCredit: resolution === 'no_show_tutor',
    reason: REASONS[resolution],
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

  if (platformCents > 0) {
    entries.push({
      account: 'platform_revenue',
      ownerId: null,
      deltaCents: platformCents,
      reason: `${outcome.reason}:commission`,
      idempotencyKey: `booking:${booking.id}:settle:platform`,
      bookingId: booking.id,
    });
  }

  assertUniqueKeys(entries);
  assertBalanced(entries, `settlement for booking ${booking.id}`);

  outcome.entries = entries;
  return outcome;
}
