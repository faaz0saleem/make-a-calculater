/**
 * Availability, as far as discovery is concerned.
 *
 * `DatabaseAvailability` is the real implementation, running the engine in
 * `./engine.ts` against the tutor's rules, exceptions and existing bookings.
 * `StubAvailability` remains for tests that need a calendar that knows nothing.
 *
 * The three-valued answers stayed after the engine landed. They are no longer
 * about a missing feature: a tutor who has published no hours at all is not the
 * same as one whose week is full, and the feed should say nothing rather than
 * "no availability" about someone who simply has not set a calendar up yet.
 */

/**
 * Deliberately three-valued. `unknown` is not `false`: the feed must be able to
 * tell "this tutor has nothing free" apart from "nobody has asked the calendar
 * yet", because only the first is worth showing a student.
 */
export type Availability<T> = { known: true; value: T } | { known: false };

export const UNKNOWN: Availability<never> = { known: false };

export function known<T>(value: T): Availability<T> {
  return { known: true, value };
}

export type NextFreeSlot = {
  startUtc: Date;
  durationMinutes: number;
};

export type SlotQuery = {
  tutorId: string;
  durationMinutes: number;
  /** Optional window; intersected with the tutor's own bookable range. */
  fromUtc?: Date;
  toUtc?: Date;
  /** Cap on returned slots, so a 30-day calendar cannot flood a response. */
  limit?: number;
};

export interface AvailabilityPort {
  readonly name: string;

  /** Bookable start times for one tutor. The calendar reads this. */
  freeSlotsFor(query: SlotQuery): Promise<Availability<NextFreeSlot[]>>;

  /** Powers the "Next free: Today 6:30 PM" line on a tutor card (SPEC.md §4). */
  nextFreeSlot(tutorId: string): Promise<Availability<NextFreeSlot | null>>;

  /** Powers the "Available today" badge (SPEC.md §4). */
  isAvailableToday(tutorId: string): Promise<Availability<boolean>>;

  /** Powers the "Available in the next hour" rail (SPEC.md §4). */
  tutorsFreeWithin(minutes: number, tutorIds: string[]): Promise<Availability<string[]>>;

  /**
   * Powers the `availability_density_next_7d` term of the ranking score
   * (SPEC.md §4), as basis points.
   *
   * Not "share of published time still free" — that would reward a tutor nobody
   * books. It measures how much bookable time a student searching now would
   * actually find, against `DENSITY_TARGET_MINUTES` of open time in a week.
   */
  densityNext7dBps(tutorIds: string[]): Promise<Availability<Map<string, number>>>;

  /** Tutors with any free slot inside a window, for the day/time filter. */
  tutorsFreeBetween(
    tutorIds: string[],
    fromUtc: Date,
    toUtc: Date,
    durationMinutes: number,
  ): Promise<Availability<string[]>>;
}

/**
 * How much open time in the next week counts as "fully available" for ranking.
 *
 * Twenty hours. Beyond that a tutor is not more findable, just emptier, and the
 * term should not keep rewarding it.
 */
export const DENSITY_TARGET_MINUTES = 20 * 60;
