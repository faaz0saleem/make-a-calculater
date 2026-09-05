/**
 * The real availability implementation (SPEC.md §5).
 *
 * Loads a tutor's weekly rules, exceptions and live bookings, and runs the pure
 * engine in `./engine.ts` over them. Nothing about scheduling is decided here —
 * this file is the part that talks to Postgres.
 *
 * Answers stay three-valued. `unknown` now means "this tutor has published no
 * hours at all", which is different from "their week is full": the first
 * deserves silence on a card, the second deserves an honest "nothing free".
 */

import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { db as defaultDb } from '@/db/client';
import type { DbLike } from '@/db/ledger';
import { availabilityExceptions, availabilityRules, bookings, tutorProfiles } from '@/db/schema';
import { ACTIVE_BOOKING_STATUSES } from '@/lib/bookings/status';
import { maskFromUtcHours } from '@/lib/ranking/overlap';
import { getLocalParts, zonedTimeToUtc } from '@/lib/time';
import {
  bookableRange,
  freeSlots,
  publishedMinutes,
  slotsWithin,
  type AvailabilityException,
  type BusyInterval,
  type Interval,
  type SlotConstraints,
  type WeeklyRule,
} from './engine';
import {
  DENSITY_TARGET_MINUTES,
  known,
  UNKNOWN,
  type Availability,
  type AvailabilityPort,
  type NextFreeSlot,
  type SlotQuery,
  type WeeklySignals,
} from './port';

/** Everything one tutor's calendar needs, in one shape. */
type TutorCalendar = {
  tutorId: string;
  timezone: string;
  rules: WeeklyRule[];
  exceptions: AvailabilityException[];
  busy: BusyInterval[];
  bookedStarts: Date[];
  constraints: SlotConstraints;
};

/** How far ahead the cheap questions look before giving up. */
const LOOKAHEAD_DAYS = 14;

export class DatabaseAvailability implements AvailabilityPort {
  readonly name = 'database';

  private readonly database: DbLike;

  constructor(database: DbLike = defaultDb) {
    this.database = database;
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * One round trip per table, for however many tutors are asked about.
   *
   * The feed asks about forty at once, so this must not be a query per tutor.
   */
  private async loadCalendars(tutorIds: string[], window: Interval): Promise<Map<string, TutorCalendar>> {
    if (tutorIds.length === 0) return new Map();

    const [profiles, ruleRows, exceptionRows, bookingRows] = await Promise.all([
      this.database
        .select({
          tutorId: tutorProfiles.userId,
          bufferMinutes: tutorProfiles.bufferMinutes,
          maxSessionsPerDay: tutorProfiles.maxSessionsPerDay,
          bookingHorizonDays: tutorProfiles.bookingHorizonDays,
          minLeadMinutes: tutorProfiles.minLeadMinutes,
        })
        .from(tutorProfiles)
        .where(inArray(tutorProfiles.userId, tutorIds)),

      this.database
        .select({
          tutorId: availabilityRules.tutorId,
          weekdayLocal: availabilityRules.weekdayLocal,
          startTimeLocal: availabilityRules.startTimeLocal,
          endTimeLocal: availabilityRules.endTimeLocal,
          timezone: availabilityRules.timezone,
          active: availabilityRules.active,
        })
        .from(availabilityRules)
        .where(and(inArray(availabilityRules.tutorId, tutorIds), eq(availabilityRules.active, true))),

      this.database
        .select({
          tutorId: availabilityExceptions.tutorId,
          kind: availabilityExceptions.kind,
          startUtc: availabilityExceptions.startUtc,
          endUtc: availabilityExceptions.endUtc,
        })
        .from(availabilityExceptions)
        .where(
          and(
            inArray(availabilityExceptions.tutorId, tutorIds),
            lt(availabilityExceptions.startUtc, window.endUtc),
            gte(availabilityExceptions.endUtc, window.startUtc),
          ),
        ),

      // Only bookings that actually hold a slot.
      this.database
        .select({
          tutorId: bookings.tutorId,
          startAtUtc: bookings.startAtUtc,
          durationMinutes: bookings.durationMinutes,
        })
        .from(bookings)
        .where(
          and(
            inArray(bookings.tutorId, tutorIds),
            inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
            lt(bookings.startAtUtc, window.endUtc),
            // Reach back a day so a session starting before the window but
            // running into it still blocks time.
            gte(bookings.startAtUtc, new Date(window.startUtc.getTime() - 86_400_000)),
          ),
        ),
    ]);

    const calendars = new Map<string, TutorCalendar>();

    for (const profile of profiles) {
      // The timezone a rule was written in is on the rule itself; fall back to
      // the first one when a tutor has rules but the profile is being read
      // without a join.
      const rules = ruleRows.filter((row) => row.tutorId === profile.tutorId);
      const timezone = rules[0]?.timezone ?? 'UTC';

      calendars.set(profile.tutorId, {
        tutorId: profile.tutorId,
        timezone,
        rules: rules.map((row) => ({
          weekdayLocal: row.weekdayLocal,
          startTimeLocal: row.startTimeLocal,
          endTimeLocal: row.endTimeLocal,
          timezone: row.timezone,
          active: row.active,
        })),
        exceptions: exceptionRows
          .filter((row) => row.tutorId === profile.tutorId)
          .map((row) => ({ kind: row.kind, startUtc: row.startUtc, endUtc: row.endUtc })),
        busy: bookingRows
          .filter((row) => row.tutorId === profile.tutorId)
          .map((row) => ({
            startUtc: row.startAtUtc,
            endUtc: new Date(row.startAtUtc.getTime() + row.durationMinutes * 60_000),
          })),
        bookedStarts: bookingRows
          .filter((row) => row.tutorId === profile.tutorId)
          .map((row) => row.startAtUtc),
        constraints: {
          bufferMinutes: profile.bufferMinutes,
          maxSessionsPerDay: profile.maxSessionsPerDay,
          bookingHorizonDays: profile.bookingHorizonDays,
          minLeadMinutes: profile.minLeadMinutes,
          timezone,
        },
      });
    }

    return calendars;
  }

  private static slotsFor(
    calendar: TutorCalendar,
    durationMinutes: number,
    now: Date,
    window?: Interval,
  ): NextFreeSlot[] {
    return freeSlots({
      rules: calendar.rules,
      exceptions: calendar.exceptions,
      busy: calendar.busy,
      bookedStarts: calendar.bookedStarts,
      constraints: calendar.constraints,
      durationMinutes,
      ...(window ? { range: window } : {}),
      now,
    }).map((slot) => ({ startUtc: slot.startUtc, durationMinutes }));
  }

  // -------------------------------------------------------------------------
  // Port
  // -------------------------------------------------------------------------

  async freeSlotsFor(query: SlotQuery, now = new Date()): Promise<Availability<NextFreeSlot[]>> {
    const horizon = bookableRange(
      { bufferMinutes: 0, maxSessionsPerDay: 1, bookingHorizonDays: 60, minLeadMinutes: 0, timezone: 'UTC' },
      now,
    );
    const window: Interval = {
      startUtc: query.fromUtc ?? horizon.startUtc,
      endUtc: query.toUtc ?? horizon.endUtc,
    };

    const calendars = await this.loadCalendars([query.tutorId], window);
    const calendar = calendars.get(query.tutorId);

    // No profile, or no published hours at all: that is unknown, not empty.
    if (!calendar || calendar.rules.length === 0) return UNKNOWN;

    const slots = DatabaseAvailability.slotsFor(calendar, query.durationMinutes, now, window);
    return known(query.limit ? slots.slice(0, query.limit) : slots);
  }

  async nextFreeSlot(tutorId: string, now = new Date()): Promise<Availability<NextFreeSlot | null>> {
    const result = await this.freeSlotsFor(
      {
        tutorId,
        durationMinutes: 30,
        toUtc: new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000),
        limit: 1,
      },
      now,
    );

    if (!result.known) return UNKNOWN;
    return known(result.value[0] ?? null);
  }

  async isAvailableToday(tutorId: string, now = new Date()): Promise<Availability<boolean>> {
    const calendars = await this.loadCalendars([tutorId], {
      startUtc: now,
      endUtc: new Date(now.getTime() + 2 * 86_400_000),
    });
    const calendar = calendars.get(tutorId);
    if (!calendar || calendar.rules.length === 0) return UNKNOWN;

    // "Today" is the tutor's day, since that is whose calendar it is.
    const today = getLocalParts(now, calendar.timezone);
    const endOfDay = zonedTimeToUtc(
      { year: today.year, month: today.month, day: today.day + 1, hour: 0, minute: 0 },
      calendar.timezone,
    );

    const slots = DatabaseAvailability.slotsFor(calendar, 30, now, { startUtc: now, endUtc: endOfDay });
    return known(slots.length > 0);
  }

  async tutorsFreeWithin(
    minutes: number,
    tutorIds: string[],
    now = new Date(),
  ): Promise<Availability<string[]>> {
    const window: Interval = { startUtc: now, endUtc: new Date(now.getTime() + minutes * 60_000) };
    return this.tutorsFreeBetween(tutorIds, window.startUtc, window.endUtc, 30, now);
  }

  async tutorsFreeBetween(
    tutorIds: string[],
    fromUtc: Date,
    toUtc: Date,
    durationMinutes = 30,
    now = new Date(),
  ): Promise<Availability<string[]>> {
    if (tutorIds.length === 0) return known([]);

    const window: Interval = { startUtc: fromUtc, endUtc: toUtc };
    const calendars = await this.loadCalendars(tutorIds, window);

    const free: string[] = [];
    for (const tutorId of tutorIds) {
      const calendar = calendars.get(tutorId);
      if (!calendar || calendar.rules.length === 0) continue;
      if (DatabaseAvailability.slotsFor(calendar, durationMinutes, now, window).length > 0) {
        free.push(tutorId);
      }
    }

    return known(free);
  }

  async weeklySignals(
    tutorIds: string[],
    now = new Date(),
  ): Promise<Availability<Map<string, WeeklySignals>>> {
    if (tutorIds.length === 0) return known(new Map());

    const window: Interval = { startUtc: now, endUtc: new Date(now.getTime() + 7 * 86_400_000) };
    const calendars = await this.loadCalendars(tutorIds, window);

    const signals = new Map<string, WeeklySignals>();

    for (const tutorId of tutorIds) {
      const calendar = calendars.get(tutorId);
      // A tutor with no published hours is left out of the map entirely, so the
      // score treats them as unknown rather than as zero.
      if (!calendar || calendar.rules.length === 0) continue;

      const slots = DatabaseAvailability.slotsFor(calendar, 30, now, window);
      const openMinutes = slots.length * 30;

      signals.set(tutorId, {
        densityBps: Math.min(
          10_000,
          Math.round((openMinutes * 10_000) / DENSITY_TARGET_MINUTES),
        ),
        // The UTC hour each open slot starts in. A week is enough to see the
        // shape of somebody's day without a single odd evening dominating it.
        freeHoursMask: maskFromUtcHours(slots.map((slot) => slot.startUtc.getUTCHours())),
      });
    }

    return known(signals);
  }

  /** Published minutes over the next week, for the tutor's own dashboard. */
  async publishedMinutesNext7d(tutorId: string, now = new Date()): Promise<number> {
    const window: Interval = { startUtc: now, endUtc: new Date(now.getTime() + 7 * 86_400_000) };
    const calendar = (await this.loadCalendars([tutorId], window)).get(tutorId);
    if (!calendar) return 0;
    return publishedMinutes(calendar.rules, calendar.exceptions, window);
  }
}

/** Re-exported so callers do not need to reach into the engine. */
export { slotsWithin };
