/**
 * Availability, as far as discovery is concerned.
 *
 * The real availability engine is Phase 3 (SPEC.md §5): weekly recurring rules,
 * exceptions, buffers, lead times, and slot expansion in two timezones. None of
 * that exists yet, and building a partial version to make the feed look busier
 * would be worse than not having it — a wrong "Next free: today 6:30 PM" costs
 * more trust than a missing one.
 *
 * So discovery asks this narrow interface instead. Today the only implementation
 * is `StubAvailability`, which answers "I don't know" to everything, and callers
 * are written to render nothing rather than guess.
 *
 * TODO(phase-3): implement `DatabaseAvailability` against the availability
 * engine in SPEC.md §5 and register it in `src/lib/availability/index.ts`. It is
 * the real source for every answer below; nothing else about this interface
 * should need to change.
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
  startAtUtc: Date;
  durationMinutes: number;
};

export interface AvailabilityPort {
  readonly name: string;

  /** Powers the "Next free: Today 6:30 PM" line on a tutor card (SPEC.md §4). */
  nextFreeSlot(tutorId: string): Promise<Availability<NextFreeSlot | null>>;

  /** Powers the "Available today" badge (SPEC.md §4). */
  isAvailableToday(tutorId: string): Promise<Availability<boolean>>;

  /** Powers the "Available in the next hour" rail (SPEC.md §4). */
  tutorsFreeWithin(minutes: number, tutorIds: string[]): Promise<Availability<string[]>>;

  /**
   * Powers the `availability_density_next_7d` term of the ranking score
   * (SPEC.md §4), as basis points: 10000 means every published hour is free.
   */
  densityNext7dBps(tutorIds: string[]): Promise<Availability<Map<string, number>>>;
}
