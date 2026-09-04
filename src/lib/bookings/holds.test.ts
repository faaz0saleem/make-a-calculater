import { describe, expect, it } from 'vitest';

import { SLOT_HOLD_MINUTES, blocksBooking, describeHold, holdExpiresAt, isHoldLive } from './holds';

const NOW = new Date('2026-05-01T12:00:00Z');
const minutes = (n: number) => n * 60_000;

describe('slot holds', () => {
  it('lasts ten minutes from when it was taken', () => {
    expect(holdExpiresAt(NOW).toISOString()).toBe('2026-05-01T12:10:00.000Z');
    expect(SLOT_HOLD_MINUTES).toBe(10);
  });

  it('is live until the moment it expires, and not after', () => {
    const hold = { expiresAt: holdExpiresAt(NOW) };
    expect(isHoldLive(hold, new Date(NOW.getTime() + minutes(9)))).toBe(true);
    expect(isHoldLive(hold, new Date(NOW.getTime() + minutes(10)))).toBe(false);
  });

  it('blocks everyone except the person who holds it', () => {
    const hold = { studentId: 'a', tutorId: 't', startAtUtc: NOW, expiresAt: holdExpiresAt(NOW) };
    expect(blocksBooking(hold, 'b', NOW)).toBe(true);
    expect(blocksBooking(hold, 'a', NOW)).toBe(false);
  });

  it('blocks nobody once it has expired', () => {
    const hold = { studentId: 'a', tutorId: 't', startAtUtc: NOW, expiresAt: holdExpiresAt(NOW) };
    expect(blocksBooking(hold, 'b', new Date(NOW.getTime() + minutes(11)))).toBe(false);
  });

  it('counts down in words while somebody is paying', () => {
    const hold = { expiresAt: holdExpiresAt(NOW) };
    expect(describeHold(hold, NOW)).toBe('10 minutes left to pay');
    expect(describeHold(hold, new Date(NOW.getTime() + minutes(9.5)))).toBe('30 seconds left to pay');
    expect(describeHold(hold, new Date(NOW.getTime() + minutes(20)))).toBe('This slot is no longer held');
  });
});
