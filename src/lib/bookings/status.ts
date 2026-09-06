/**
 * Booking statuses and the only legal transitions between them (SPEC.md §5, §13.7).
 *
 * Every status change goes through `transitionBooking`. There are no scattered
 * `status = 'x'` updates anywhere else in the codebase.
 */

export const BOOKING_STATUSES = [
  /**
   * A recurring occurrence that has been materialised but not paid for.
   *
   * It holds the slot — nobody else can take that hour — and carries no money.
   * Credits are debited at its own T-48h, which is when it becomes `confirmed`.
   * A month of sessions is a commitment, not a prepayment (SPEC.md §5,
   * DECISIONS_NEEDED item 32).
   */
  'scheduled',
  'pending_tutor',
  'confirmed',
  'in_progress',
  'completed',
  'settled',
  'cancelled_by_student',
  'cancelled_by_tutor',
  'expired',
  /**
   * A recurring occurrence the student could not cover at T-48h.
   *
   * Distinct from `expired` because the tutor needs to know *why* their Tuesday
   * disappeared, and distinct from a cancellation because nobody chose it. No
   * money moved, so there is nothing to settle.
   */
  'lapsed',
  'no_show_student',
  'no_show_tutor',
  'disputed',
  'refunded',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Statuses that hold a slot on the tutor's calendar (see the partial unique index).
 *
 * `scheduled` is in here even though no money has moved: the whole point of a
 * recurring series is that Tuesday at six is *taken*, and a one-off booking
 * must not be able to walk into it.
 */
export const ACTIVE_BOOKING_STATUSES = ['scheduled', 'pending_tutor', 'confirmed', 'in_progress'] as const;

/** Statuses no transition can leave. */
export const TERMINAL_BOOKING_STATUSES = [
  'settled',
  'cancelled_by_student',
  'cancelled_by_tutor',
  'expired',
  'lapsed',
  'refunded',
] as const;

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  // A materialised recurring occurrence. It becomes `confirmed` when its
  // credits are taken at T-48h, and `lapsed` when they cannot be.
  scheduled: ['confirmed', 'cancelled_by_student', 'cancelled_by_tutor', 'lapsed'],
  // Trials only: the tutor must accept before the slot is really held.
  pending_tutor: ['confirmed', 'cancelled_by_student', 'cancelled_by_tutor', 'expired'],
  confirmed: [
    'in_progress',
    'cancelled_by_student',
    'cancelled_by_tutor',
    'no_show_student',
    'no_show_tutor',
    'disputed',
  ],
  in_progress: ['completed', 'no_show_student', 'no_show_tutor', 'disputed'],
  // The 24h dispute window sits between completed and settled.
  completed: ['settled', 'disputed'],
  // Money outcomes that still need settling land here first.
  no_show_student: ['settled', 'disputed'],
  no_show_tutor: ['refunded', 'disputed'],
  disputed: ['settled', 'refunded'],
  settled: [],
  cancelled_by_student: [],
  cancelled_by_tutor: [],
  expired: [],
  // Nothing was ever charged, so there is nothing to settle or refund.
  lapsed: [],
  refunded: [],
};

export class BookingTransitionError extends Error {
  readonly from: BookingStatus;
  readonly to: BookingStatus;

  constructor(from: BookingStatus, to: BookingStatus) {
    super(`illegal booking transition: ${from} -> ${to}`);
    this.name = 'BookingTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: BookingStatus): boolean {
  return (TERMINAL_BOOKING_STATUSES as readonly BookingStatus[]).includes(status);
}

export function isActive(status: BookingStatus): boolean {
  return (ACTIVE_BOOKING_STATUSES as readonly BookingStatus[]).includes(status);
}

/**
 * The one function that owns booking status changes. Callers pass the current
 * status and the intended one; anything illegal throws rather than silently
 * writing a bad row.
 */
export function transitionBooking(from: BookingStatus, to: BookingStatus): BookingStatus {
  if (!canTransition(from, to)) {
    throw new BookingTransitionError(from, to);
  }
  return to;
}
