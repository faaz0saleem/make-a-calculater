import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATUSES,
  BookingTransitionError,
  canTransition,
  isActive,
  isTerminal,
  transitionBooking,
  type BookingStatus,
} from './status';

describe('booking state machine', () => {
  it('walks the happy path', () => {
    expect(transitionBooking('pending_tutor', 'confirmed')).toBe('confirmed');
    expect(transitionBooking('confirmed', 'in_progress')).toBe('in_progress');
    expect(transitionBooking('in_progress', 'completed')).toBe('completed');
    expect(transitionBooking('completed', 'settled')).toBe('settled');
  });

  it('refuses to skip states', () => {
    expect(() => transitionBooking('confirmed', 'settled')).toThrow(BookingTransitionError);
    expect(() => transitionBooking('pending_tutor', 'in_progress')).toThrow(BookingTransitionError);
  });

  it('refuses to leave a terminal state', () => {
    for (const status of ['settled', 'cancelled_by_student', 'expired', 'refunded'] as BookingStatus[]) {
      expect(isTerminal(status)).toBe(true);
      for (const target of BOOKING_STATUSES) {
        expect(canTransition(status, target)).toBe(false);
      }
    }
  });

  it('knows which statuses hold a calendar slot', () => {
    expect(isActive('pending_tutor')).toBe(true);
    expect(isActive('confirmed')).toBe(true);
    expect(isActive('in_progress')).toBe(true);
    expect(isActive('completed')).toBe(false);
    expect(isActive('cancelled_by_student')).toBe(false);
  });

  it('routes a no-show to settlement or refund, not straight to completed', () => {
    expect(canTransition('confirmed', 'no_show_student')).toBe(true);
    expect(canTransition('no_show_student', 'settled')).toBe(true);
    expect(canTransition('no_show_tutor', 'refunded')).toBe(true);
    expect(canTransition('no_show_tutor', 'settled')).toBe(false);
  });

  it('lets either side raise a dispute from a live booking', () => {
    expect(canTransition('confirmed', 'disputed')).toBe(true);
    expect(canTransition('completed', 'disputed')).toBe(true);
    expect(canTransition('disputed', 'refunded')).toBe(true);
  });
});
