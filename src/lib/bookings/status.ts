/**
 * Booking statuses and the only legal transitions between them (SPEC.md §5, §13.7).
 *
 * Every status change goes through `transitionBooking`. There are no scattered
 * `status = 'x'` updates anywhere else in the codebase.
 */

export const BOOKING_STATUSES = [
  'pending_tutor',
  'confirmed',
  'in_progress',
  'completed',
  'settled',
  'cancelled_by_student',
  'cancelled_by_tutor',
  'expired',
  'no_show_student',
  'no_show_tutor',
  'disputed',
  'refunded',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses that hold a slot on the tutor's calendar (see the partial unique index). */
export const ACTIVE_BOOKING_STATUSES = ['pending_tutor', 'confirmed', 'in_progress'] as const;

/** Statuses no transition can leave. */
export const TERMINAL_BOOKING_STATUSES = [
  'settled',
  'cancelled_by_student',
  'cancelled_by_tutor',
  'expired',
  'refunded',
] as const;

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
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
