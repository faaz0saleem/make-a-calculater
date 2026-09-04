/**
 * The timezone-overlap ranking term.
 *
 * All teaching here is live, so a tutor is only useful to a student if their
 * free hours land at an hour that student can actually sit down. A brilliant
 * tutor in São Paulo whose evenings are 3am in Karachi should not lead the feed
 * for a Karachi student, and no rating, completion rate or response time makes
 * that any less true.
 *
 * The shape is deliberately cheap, because half of it has to run per request:
 *
 *  - The tutor side is a 24-bit mask of the UTC hours they are typically free,
 *    computed by the nightly job from the availability engine and stored on
 *    `tutor_ranking.free_hours_mask`. That is where the work is.
 *  - The viewer side is the same mask for their own reasonable study hours,
 *    built once per request from their timezone.
 *  - The term itself is `popcount(tutor & viewer)` — a bitwise AND and a bit
 *    count, which is not "computing ranking in the request path" any more than
 *    comparing two integers is.
 *
 * Pure. The mask depends on the instant only through the timezone's offset at
 * that instant, which is what makes it DST-correct: the nightly job recomputes
 * every tutor's mask daily, and the viewer's is built from `now`.
 */

import { getTimeZoneOffsetMinutes } from '@/lib/time';

export const HOURS_IN_DAY = 24;

/**
 * The hours a student can plausibly take a lesson, in their own local time.
 * End is exclusive, so this is 07:00 up to 22:00.
 */
export const STUDY_WINDOW_START_HOUR = 7;
export const STUDY_WINDOW_END_HOUR = 22;

/**
 * Overlapping hours at which the term is fully earned.
 *
 * Three, not six. Six was measured against a world where tutor and student
 * share a working day; the actual market does not. Lahore to London is a five
 * hour offset, so a London tutor teaching their own evening shares barely an
 * hour with a Karachi student's — and a bar that fails that pair fails the
 * corridor the product is being built for.
 *
 * Past three the term stops paying: a tutor free all day is not more bookable
 * for this student than one free for an afternoon, just more awake.
 */
export const OVERLAP_TARGET_HOURS = 3;

/** The most the term can move a score, in basis points of the 0-10000 range. */
export const OVERLAP_MAX_BPS = 1_200;

/**
 * What a tutor scores when their mask is empty.
 *
 * An empty mask means "this tutor has published no hours", not "this tutor is
 * never free when you are" — the same distinction the availability port draws
 * with `unknown`. Scoring it zero would quietly bury every tutor who has not
 * set a calendar up yet, so it takes the midpoint, which cancels out of the
 * ordering for everybody who shares it.
 */
export const OVERLAP_UNKNOWN_BPS = Math.round(OVERLAP_MAX_BPS / 2);

/** Every bit set — used when the viewer has no timezone worth trusting. */
export const ALL_HOURS_MASK = (1 << HOURS_IN_DAY) - 1;

/**
 * The UTC hours covered by a local hour range in `timeZone`.
 *
 * Offsets are not always whole hours — Asia/Kolkata is +05:30, Asia/Kathmandu
 * +05:45 — so a local hour can straddle two UTC hours. Both are set: a student
 * in Delhi studying at 19:00 IST really is partly in UTC hour 13 and partly in
 * 14, and a tutor free in either can teach them.
 */
export function localWindowMaskUtc(
  timeZone: string,
  startHour: number,
  endHour: number,
  at: Date = new Date(),
): number {
  let offsetMinutes: number;
  try {
    offsetMinutes = getTimeZoneOffsetMinutes(at, timeZone);
  } catch {
    // An unknown timezone must not silently narrow somebody's feed to nothing.
    return ALL_HOURS_MASK;
  }

  let mask = 0;
  for (let localHour = startHour; localHour < endHour; localHour += 1) {
    // The local hour [localHour, localHour + 1) in UTC minutes since midnight.
    const fromMinutes = localHour * 60 - offsetMinutes;
    const toMinutes = fromMinutes + 60;

    const firstHour = Math.floor(fromMinutes / 60);
    // Exclusive end: an hour that ends exactly on the boundary does not touch
    // the next one.
    const lastHour = Math.ceil(toMinutes / 60) - 1;

    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      mask |= 1 << (((hour % HOURS_IN_DAY) + HOURS_IN_DAY) % HOURS_IN_DAY);
    }
  }

  return mask;
}

/** A viewer's study window, as a UTC hour mask. */
export function studyWindowMaskUtc(timeZone: string, at: Date = new Date()): number {
  return localWindowMaskUtc(timeZone, STUDY_WINDOW_START_HOUR, STUDY_WINDOW_END_HOUR, at);
}

/** How many UTC hours two masks share. */
export function overlapHours(tutorMask: number, viewerMask: number): number {
  let bits = tutorMask & viewerMask & ALL_HOURS_MASK;
  let count = 0;
  while (bits !== 0) {
    bits &= bits - 1;
    count += 1;
  }
  return count;
}

/**
 * The term itself, in basis points, added on top of the nightly score.
 *
 * `OVERLAP_MAX_BPS` is a twelfth of the score range — bigger than the gap
 * between a 4.6 and a 4.9 tutor, which is roughly 225 points. That ordering is
 * intentional: being reachable at a workable hour matters more than three
 * tenths of a star.
 *
 * **Graduated, not a threshold.** A single shared hour is not nothing — it is
 * one lesson a week that actually happens — so it earns a third of the term
 * rather than falling off a cliff to zero. Only genuinely no shared hour scores
 * nothing.
 *
 * And the term can never overturn a curriculum match, because the match tier is
 * a separate leading key in the ordering: a tutor teaching the student's exact
 * board, class and subject with two workable hours stays above a tutor with
 * neither, whatever this returns.
 */
export function overlapBonusBps(tutorMask: number, viewerMask: number): number {
  if (tutorMask === 0) return OVERLAP_UNKNOWN_BPS;

  const shared = Math.min(overlapHours(tutorMask, viewerMask), OVERLAP_TARGET_HOURS);
  return Math.round((shared * OVERLAP_MAX_BPS) / OVERLAP_TARGET_HOURS);
}

/** A mask from a list of UTC hours, for the nightly job. */
export function maskFromUtcHours(hours: Iterable<number>): number {
  let mask = 0;
  for (const hour of hours) {
    if (!Number.isInteger(hour) || hour < 0 || hour >= HOURS_IN_DAY) continue;
    mask |= 1 << hour;
  }
  return mask;
}

/** The UTC hours in a mask, ascending. Used by tests and admin display. */
export function hoursFromMask(mask: number): number[] {
  const hours: number[] = [];
  for (let hour = 0; hour < HOURS_IN_DAY; hour += 1) {
    if ((mask & (1 << hour)) !== 0) hours.push(hour);
  }
  return hours;
}
