/**
 * Turning LiveKit webhooks into an attendance record (SPEC.md §7).
 *
 * "Attendance and duration come from these events, never from the client."
 * This module is the only thing that decides how long anybody was in a session,
 * and its output feeds `resolveBookingOutcome` unchanged — there is no money
 * logic here, only the measurement that money logic consumes.
 *
 * Three things make this harder than counting a join and a leave:
 *
 *  - People reconnect. A dropped mobile connection produces leave/join pairs
 *    that must add up rather than being read as two separate visits.
 *  - Leaves go missing. A killed browser may never send one, so `room_finished`
 *    closes any interval still open.
 *  - Time outside the booked window does not count. Someone who joins five
 *    minutes early is not owed five extra minutes, and the grace period past
 *    the end is a courtesy, not billable time.
 */

import type { Attendance } from '@/lib/money/outcomes';
import type { SessionWindow } from './window';

export type SessionEventKind = 'room_started' | 'participant_joined' | 'participant_left' | 'room_finished';

export type SessionEvent = {
  event: SessionEventKind;
  /** Null for room-level events. */
  userId: string | null;
  atUtc: Date;
};

type Interval = { start: number; end: number };

/** Clamps to the booked window, then drops anything that collapses to nothing. */
function clamp(intervals: Interval[], window: SessionWindow): Interval[] {
  const from = window.startUtc.getTime();
  const to = window.endUtc.getTime();

  return intervals
    .map((interval) => ({ start: Math.max(interval.start, from), end: Math.min(interval.end, to) }))
    .filter((interval) => interval.end > interval.start);
}

function merge(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...sorted[0]! }];

  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }

  return merged;
}

function totalSeconds(intervals: Interval[]): number {
  return Math.round(intervals.reduce((sum, interval) => sum + (interval.end - interval.start), 0) / 1_000);
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const result: Interval[] = [];

  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (end > start) result.push({ start, end });
    }
  }

  return merge(result);
}

function subtract(from: Interval[], holes: Interval[]): Interval[] {
  let remaining = from.map((interval) => ({ ...interval }));

  for (const hole of merge(holes)) {
    const next: Interval[] = [];
    for (const interval of remaining) {
      if (hole.end <= interval.start || hole.start >= interval.end) {
        next.push(interval);
        continue;
      }
      if (interval.start < hole.start) next.push({ start: interval.start, end: hole.start });
      if (hole.end < interval.end) next.push({ start: hole.end, end: interval.end });
    }
    remaining = next;
  }

  return remaining;
}

/**
 * The intervals one participant was connected for.
 *
 * A join while already joined is ignored rather than restarting the interval —
 * LiveKit can repeat an event, and a duplicate must not be read as a reconnect.
 */
export function presenceFor(events: SessionEvent[], userId: string, closedAt: number): Interval[] {
  const ordered = events
    .filter((event) => event.userId === userId)
    .sort((a, b) => a.atUtc.getTime() - b.atUtc.getTime());

  const intervals: Interval[] = [];
  let openedAt: number | null = null;

  for (const event of ordered) {
    if (event.event === 'participant_joined') {
      openedAt ??= event.atUtc.getTime();
    } else if (event.event === 'participant_left' && openedAt !== null) {
      intervals.push({ start: openedAt, end: event.atUtc.getTime() });
      openedAt = null;
    }
  }

  // Still connected when the room closed — or the browser died without a leave.
  if (openedAt !== null) intervals.push({ start: openedAt, end: closedAt });

  return merge(intervals.filter((interval) => interval.end > interval.start));
}

export type AttendanceSummary = Attendance & {
  kind: 'session';
  /** How many times each side had to reconnect, for support and for the tutor. */
  studentReconnects: number;
  tutorReconnects: number;
};

/**
 * Fold a session's events into what `resolveBookingOutcome` needs.
 *
 * `now` closes any interval left open when there is no `room_finished` — a
 * settlement running a day later should not credit somebody for a browser tab
 * it believes is still connected.
 */
export function summariseAttendance(params: {
  events: SessionEvent[];
  window: SessionWindow;
  studentId: string;
  tutorId: string;
  now: Date;
}): AttendanceSummary {
  const { events, window, studentId, tutorId, now } = params;

  const roomFinished = events.find((event) => event.event === 'room_finished');
  // Nothing is counted past the booked end anyway, so the earliest sensible
  // close is whichever of those comes first.
  const closedAt = Math.min(
    roomFinished?.atUtc.getTime() ?? Number.POSITIVE_INFINITY,
    now.getTime(),
    window.endUtc.getTime(),
  );

  const studentRaw = presenceFor(events, studentId, closedAt);
  const tutorRaw = presenceFor(events, tutorId, closedAt);

  const student = clamp(studentRaw, window);
  const tutor = clamp(tutorRaw, window);

  const together = intersect(student, tutor);
  // Time the tutor was there and the student was not.
  const tutorAlone = subtract(tutor, student);

  const countReconnects = (intervals: Interval[]) => Math.max(0, intervals.length - 1);

  return {
    kind: 'session',
    studentSeconds: totalSeconds(student),
    tutorSeconds: totalSeconds(tutor),
    bothPresentSeconds: totalSeconds(together),
    tutorWaitedAloneSeconds: totalSeconds(tutorAlone),
    studentReconnects: countReconnects(studentRaw),
    tutorReconnects: countReconnects(tutorRaw),
  };
}
