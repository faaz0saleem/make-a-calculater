/**
 * When to nudge, and whom (SPEC.md §7).
 *
 * Pure. A session and an instant in, a list of reminders due out.
 *
 * The schedule is asymmetric on purpose. Both sides get T-24h and T-1h; only
 * the tutor gets T-10min, and it is worded more strongly. That is not a
 * courtesy to the student — it is who owes what. The tutor is being paid, and a
 * professional should be in the room first. A student who is late has
 * inconvenienced somebody; a tutor who is late has failed to deliver a service.
 */

import { NO_SHOW_WAIT_SECONDS } from '@/lib/money/outcomes';

export type ReminderKind = 'day' | 'hour' | 'final';
export type ReminderAudience = 'student' | 'tutor';

export type ReminderSlot = {
  kind: ReminderKind;
  audience: ReminderAudience;
  /** Minutes before the start. */
  minutesBefore: number;
};

export const REMINDER_SCHEDULE: readonly ReminderSlot[] = [
  { kind: 'day', audience: 'student', minutesBefore: 24 * 60 },
  { kind: 'day', audience: 'tutor', minutesBefore: 24 * 60 },
  { kind: 'hour', audience: 'student', minutesBefore: 60 },
  { kind: 'hour', audience: 'tutor', minutesBefore: 60 },
  // The tutor only. They are the one being paid to be there.
  { kind: 'final', audience: 'tutor', minutesBefore: 10 },
];

/**
 * How late a reminder may still be sent.
 *
 * A job that ran an hour late should send the T-1h nudge if it is still
 * useful, and should not send a T-10min one that would land after the lesson
 * started — a reminder for something already happening reads as a system
 * nobody is minding.
 */
export const REMINDER_GRACE_MINUTES = 20;

export type DueReminder = ReminderSlot & { dueAt: Date };

/** Reminders whose moment has arrived and not yet passed out of usefulness. */
export function remindersDue(startAtUtc: Date, now: Date): DueReminder[] {
  return REMINDER_SCHEDULE.map((slot) => ({
    ...slot,
    dueAt: new Date(startAtUtc.getTime() - slot.minutesBefore * 60_000),
  })).filter((slot) => {
    if (now < slot.dueAt) return false;

    // Never after the lesson has begun, whatever the grace period says.
    if (now >= startAtUtc) return false;

    const lateBy = (now.getTime() - slot.dueAt.getTime()) / 60_000;
    return lateBy <= REMINDER_GRACE_MINUTES;
  });
}

/** Stops a job that runs every five minutes sending the same nudge twelve times. */
export function reminderKey(bookingId: string, slot: ReminderSlot): string {
  return `reminder:${bookingId}:${slot.kind}:${slot.audience}`;
}

export type ReminderCopy = { title: string; body: string; whatsapp: string };

/**
 * What each reminder says.
 *
 * The tutor's final one is the only one that names a consequence, because it is
 * the only one where there is a consequence: a tutor who does not appear is a
 * refund, and after that a ranking penalty.
 */
export function reminderCopy(
  slot: ReminderSlot,
  context: { otherName: string; whenLocal: string; isTrial: boolean },
): ReminderCopy {
  const who = context.otherName;
  const lesson = context.isTrial ? 'trial lesson' : 'lesson';

  switch (slot.kind) {
    case 'day':
      return {
        title: `Tomorrow: your ${lesson} with ${who}`,
        body: `${context.whenLocal}. Add it to your calendar if you have not.`,
        whatsapp: `Tutorly: your ${lesson} with ${who} is tomorrow, ${context.whenLocal}.`,
      };
    case 'hour':
      return {
        title: `In an hour: ${who}`,
        body: `${context.whenLocal}. The room opens ten minutes before.`,
        whatsapp: `Tutorly: your ${lesson} with ${who} starts in an hour (${context.whenLocal}).`,
      };
    case 'final':
    default:
      return {
        title: `Ten minutes: ${who} is expecting you`,
        body: `The room is open. Being there first is the difference between a lesson and a refund — a session you miss is refunded to the student and counts against your ranking.`,
        whatsapp: `Tutorly: your ${lesson} with ${who} starts in 10 minutes. The room is open.`,
      };
  }
}

// ---------------------------------------------------------------------------
// The empty room
// ---------------------------------------------------------------------------

/** How long after the start one person alone is worth telling somebody about. */
export const ALONE_AFTER_MINUTES = 2;

export type WaitingState =
  | { kind: 'too_early' }
  | { kind: 'waiting'; secondsLeft: number; absent: ReminderAudience }
  | { kind: 'settled'; absent: ReminderAudience };

/**
 * What the person sitting in an empty room should be shown.
 *
 * The clock is `NO_SHOW_WAIT_SECONDS` from `lib/money/outcomes.ts` — the same
 * number that decides the money — counted from when the waiting actually
 * started rather than from the session's start time. Those are different
 * instants: the room opens before the hour, so somebody early has often been
 * alone for a while by the time it begins.
 *
 * Deriving it rather than restating it is the whole point. A countdown that
 * said fifteen while settlement used ten would be a screen that lies to
 * somebody about their own money, and it would drift the first time either
 * number moved.
 */
export function waitingState(
  aloneSince: Date,
  startAtUtc: Date,
  now: Date,
  absent: ReminderAudience,
): WaitingState {
  const sinceStart = (now.getTime() - startAtUtc.getTime()) / 60_000;
  if (sinceStart < ALONE_AFTER_MINUTES) return { kind: 'too_early' };

  const decidesAt = aloneSince.getTime() + NO_SHOW_WAIT_SECONDS * 1_000;
  if (now.getTime() >= decidesAt) return { kind: 'settled', absent };

  return {
    kind: 'waiting',
    absent,
    secondsLeft: Math.max(0, Math.round((decidesAt - now.getTime()) / 1_000)),
  };
}

/**
 * What happens at zero, said before it happens.
 *
 * Both sides read the same sentence from opposite ends, and it names who gets
 * paid — the thing somebody waiting actually wants to know.
 */
export function waitingConsequence(absent: ReminderAudience, viewerIsTutor: boolean): string {
  if (absent === 'student') {
    return viewerIsTutor
      ? 'If they have not joined by then, the session is recorded as a no-show and you are paid in full for the hour you held.'
      : 'If you are not in the room by then, the session is recorded as a no-show and your tutor is paid for the hour they held.';
  }

  return viewerIsTutor
    ? 'If you are not in the room by then, the session is refunded in full to your student and it counts against your ranking.'
    : 'If they have not joined by then, you get every credit back and the session counts against their ranking.';
}
