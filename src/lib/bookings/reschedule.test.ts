import { describe, expect, it } from 'vitest';

import {
  isRescheduleExpired,
  rescheduleExpiresAt,
  rescheduleProblem,
  rescheduleProblemMessage,
  type ReschedulableBooking,
} from './reschedule';

const NOW = new Date('2026-05-01T12:00:00Z');
const hours = (n: number) => n * 3_600_000;

const booking: ReschedulableBooking = {
  status: 'confirmed',
  startAtUtc: new Date(NOW.getTime() + hours(48)),
  rescheduleCount: 0,
  isTrial: false,
};

describe('rescheduleProblem', () => {
  it('lets a confirmed session two days out be moved', () => {
    expect(rescheduleProblem(booking, NOW)).toBeNull();
  });

  it('allows it right up to twelve hours before, and not after', () => {
    const justOutside = { ...booking, startAtUtc: new Date(NOW.getTime() + hours(12) + 60_000) };
    const justInside = { ...booking, startAtUtc: new Date(NOW.getTime() + hours(12)) };
    expect(rescheduleProblem(justOutside, NOW)).toBeNull();
    expect(rescheduleProblem(justInside, NOW)).toBe('too_close');
  });

  it('allows it once', () => {
    expect(rescheduleProblem({ ...booking, rescheduleCount: 1 }, NOW)).toBe('already_rescheduled');
  });

  it('refuses anything that is not a confirmed booking', () => {
    expect(rescheduleProblem({ ...booking, status: 'pending_tutor' }, NOW)).toBe('not_reschedulable');
    expect(rescheduleProblem({ ...booking, status: 'settled' }, NOW)).toBe('not_reschedulable');
  });

  it('refuses a trial, which is cancelled and re-asked instead', () => {
    expect(rescheduleProblem({ ...booking, isTrial: true }, NOW)).toBe('trial');
  });

  it('refuses a second request while one is still waiting', () => {
    expect(rescheduleProblem(booking, NOW, true)).toBe('already_requested');
  });

  it('says something actionable for each problem', () => {
    for (const problem of [
      'not_reschedulable', 'already_rescheduled', 'too_close', 'trial', 'already_requested',
    ] as const) {
      expect(rescheduleProblemMessage(problem).length).toBeGreaterThan(20);
    }
  });
});

describe('rescheduleExpiresAt', () => {
  it('gives the other side six hours', () => {
    const newStart = new Date(NOW.getTime() + hours(72));
    expect(rescheduleExpiresAt(NOW, newStart).getTime()).toBe(NOW.getTime() + hours(6));
  });

  it('never outlives the time it proposes', () => {
    // Someone proposing a slot four hours from now gets four hours of answer,
    // not six — accepting after it had started would move nothing.
    const newStart = new Date(NOW.getTime() + hours(4));
    expect(rescheduleExpiresAt(NOW, newStart).getTime()).toBe(newStart.getTime());
  });

  it('is expired the moment its deadline passes', () => {
    const request = { requestedAt: NOW, newStartAtUtc: new Date(NOW.getTime() + hours(72)) };
    expect(isRescheduleExpired(request, new Date(NOW.getTime() + hours(5)))).toBe(false);
    expect(isRescheduleExpired(request, new Date(NOW.getTime() + hours(6)))).toBe(true);
  });
});
