/**
 * Slot holds (SPEC.md §5).
 *
 * A student who picks a slot and finds they are short of credits should not
 * lose it while they buy more. So picking puts a ten-minute hold on it: nobody
 * else can take that slot, and the student can finish paying without racing a
 * stranger.
 *
 * The hold expires **when it is read**, not when a sweeper gets round to it. A
 * job every five minutes leaves five minutes in which a slot looks taken and is
 * not — which is worse than no hold at all, because the calendar is lying.
 * Nothing here writes; the queries filter on `expires_at > now()`.
 *
 * A hold is not a booking. It blocks other people from the slot and nothing
 * more: the real guarantee is still the partial unique index on
 * `(tutor_id, start_at_utc)`, which a hold cannot substitute for.
 */

/** Long enough to buy credits on a slow connection, short enough not to squat. */
export const SLOT_HOLD_MINUTES = 10;

export type SlotHold = {
  studentId: string;
  tutorId: string;
  startAtUtc: Date;
  expiresAt: Date;
};

export function holdExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SLOT_HOLD_MINUTES * 60_000);
}

export function isHoldLive(hold: Pick<SlotHold, 'expiresAt'>, now: Date): boolean {
  return hold.expiresAt.getTime() > now.getTime();
}

export function holdSecondsRemaining(hold: Pick<SlotHold, 'expiresAt'>, now: Date): number {
  return Math.max(0, Math.round((hold.expiresAt.getTime() - now.getTime()) / 1_000));
}

/**
 * Whether this hold stops `studentId` booking the slot.
 *
 * Their own live hold does not — that is what it is for.
 */
export function blocksBooking(hold: SlotHold, studentId: string, now: Date): boolean {
  return isHoldLive(hold, now) && hold.studentId !== studentId;
}

/** "9 minutes left to pay" — shown while the student is topping up. */
export function describeHold(hold: Pick<SlotHold, 'expiresAt'>, now: Date): string {
  const seconds = holdSecondsRemaining(hold, now);
  if (seconds === 0) return 'This slot is no longer held';
  if (seconds < 60) return `${seconds} seconds left to pay`;
  return `${Math.round(seconds / 60)} minutes left to pay`;
}
