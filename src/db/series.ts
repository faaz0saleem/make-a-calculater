/**
 * Standing arrangements (SPEC.md §5, DECISIONS_NEEDED item 32).
 *
 * The market this is built for sells a month: "three sessions a week, 50,000 a
 * month". A student who has decided that should not have to decide it again
 * every Tuesday — so a series is one decision, made once, and the occurrences
 * fall out of it.
 *
 * Three rules hold the file together, and all three are about money:
 *
 *  1. **A series never takes a month's credits.** Each occurrence is charged
 *     at its own T-48h. Holding four weeks of somebody's money against
 *     tutoring that has not happened is a float we have not earned, and it is
 *     the difference between a commitment and a prepayment.
 *  2. **A session that cannot be paid for lapses, visibly.** The student is
 *     warned at T-72h, and if the wallet is still short at T-48h the
 *     occurrence goes to `lapsed` and both sides are told. It does not
 *     silently vanish from a calendar somebody planned around.
 *  3. **The price is snapshotted on the series, not re-read per occurrence.**
 *     A standing arrangement at an agreed rate is what both sides think they
 *     agreed. A tutor who wants a new price ends the series and offers a new
 *     one, which is a conversation rather than a surprise.
 *
 * Materialisation is idempotent by construction: `one_booking_per_occurrence`
 * is a unique index, not a check in this file, so running the job twice — a
 * cron retry, two workers, a hand-run during a backfill — cannot double-book.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { appendLedger } from './ledger';
import { db as defaultDb, type Database } from './client';
import type { DbLike } from './ledger';
import { hasCompletedPaidSession } from './bookings';
import { notify } from './notifications';
import { emailBookingConfirmed, emailCreditsLow } from './email-events';
import { setBookingTopics, seriesTopicIds, setSeriesTopics } from './topics';
import { moveBookingStatus } from './sessions';
import {
  bookings,
  recurringSeries,
  seriesTopics,
  studentWallets,
  topics,
  tutorProfiles,
  users,
} from './schema';
import { DatabaseAvailability } from '@/lib/availability/database';
import { formatCents } from '@/lib/money/cents';
import { bookingEscrowEntries } from '@/lib/money/ledger';
import { priceForBooking } from '@/lib/money/pricing';
import {
  dateInZone,
  describeSchedule,
  occurrencesBetween,
  toDateString,
  type Occurrence,
} from '@/lib/series/occurrences';
import {
  chargeDueAt,
  commissionForOccurrence,
  isSeriesDuration,
  MATERIALISE_DAYS,
  noticeEndsOn,
  WARN_HOURS_BEFORE,
  warnDueAt,
  type SeriesDuration,
} from '@/lib/series/rules';
import { getLocalParts, isClock } from '@/lib/time';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type SeriesProblem =
  | 'bad_time'
  | 'own_profile'
  | 'no_such_tutor'
  | 'not_bookable'
  | 'bad_duration'
  | 'no_weekdays'
  | 'not_available'
  | 'already_running';

const PROBLEMS: Record<SeriesProblem, string> = {
  bad_time: 'Pick a time of day.',
  own_profile: 'You cannot book a standing arrangement with yourself.',
  no_such_tutor: 'That tutor could not be found.',
  not_bookable: 'This tutor is not taking bookings at the moment.',
  bad_duration: 'Pick a session length of 30, 60, 90 or 120 minutes.',
  no_weekdays: 'Pick at least one day of the week.',
  not_available:
    'That time is not free every week you picked. Try a different time, or fewer days.',
  already_running: 'You already have a standing arrangement with this tutor.',
};

export function seriesProblemMessage(problem: SeriesProblem): string {
  return PROBLEMS[problem];
}

export type CreateSeriesResult =
  | { ok: true; seriesId: string; created: number; priceCents: number }
  | { ok: false; problem: SeriesProblem; clashes?: string[] };

export type SeriesRow = {
  id: string;
  studentId: string;
  tutorId: string;
  subjectId: string | null;
  weekdays: number[];
  startTimeLocal: string;
  timezone: string;
  durationMinutes: number;
  priceCents: number;
  startsOn: string;
  endsOn: string | null;
  status: string;
  endedBy: string | null;
  endReason: string | null;
  topicNote: string | null;
  createdAt: Date;
};

const SERIES_VIEW = {
  id: recurringSeries.id,
  studentId: recurringSeries.studentId,
  tutorId: recurringSeries.tutorId,
  subjectId: recurringSeries.subjectId,
  weekdays: recurringSeries.weekdays,
  startTimeLocal: recurringSeries.startTimeLocal,
  timezone: recurringSeries.timezone,
  durationMinutes: recurringSeries.durationMinutes,
  priceCents: recurringSeries.priceCents,
  startsOn: recurringSeries.startsOn,
  endsOn: recurringSeries.endsOn,
  status: recurringSeries.status,
  endedBy: recurringSeries.endedBy,
  endReason: recurringSeries.endReason,
  topicNote: recurringSeries.topicNote,
  createdAt: recurringSeries.createdAt,
} as const;

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

/**
 * Start a standing arrangement.
 *
 * Every occurrence in the first window is checked against the real
 * availability engine before anything is written, and the ones that do not fit
 * come back in `clashes` so the student is told *which* Tuesday is the problem
 * rather than "that does not work".
 *
 * No credits are taken here. The first occurrence is charged at its own T-48h
 * like every other one, so agreeing to a series costs nothing today — which is
 * the whole point of not selling it as a month up front.
 */
export async function createSeries(
  input: {
    studentId: string;
    tutorId: string;
    weekdays: number[];
    startTimeLocal: string;
    durationMinutes: number;
    subjectId?: string | null;
    /** Chapters the arrangement is for. Copied onto every occurrence. */
    topicIds?: readonly string[];
    /** The sentence a taxonomy cannot hold. Copied onto every occurrence too. */
    topicNote?: string | null;
    /** Local date in the tutor's timezone. Defaults to today. */
    startsOn?: string;
  },
  now = new Date(),
  database: Database = defaultDb,
): Promise<CreateSeriesResult> {
  if (input.studentId === input.tutorId) return { ok: false, problem: 'own_profile' };
  if (!isSeriesDuration(input.durationMinutes)) return { ok: false, problem: 'bad_duration' };
  if (!isClock(input.startTimeLocal)) return { ok: false, problem: 'bad_time' };
  const durationMinutes: SeriesDuration = input.durationMinutes;

  const weekdays = [...new Set(input.weekdays)].filter((day) => day >= 0 && day <= 6).sort();
  if (weekdays.length === 0) return { ok: false, problem: 'no_weekdays' };

  return database.transaction(async (tx) => {
    const [tutor] = await tx
      .select({
        userId: tutorProfiles.userId,
        status: tutorProfiles.status,
        hourlyCents: tutorProfiles.hourlyCents,
        halfHourCents: tutorProfiles.halfHourCents,
        promoCents: tutorProfiles.promoCents,
        promoStartsAt: tutorProfiles.promoStartsAt,
        promoEndsAt: tutorProfiles.promoEndsAt,
        negotiatedCommissionBps: tutorProfiles.commissionBps,
        minLeadMinutes: tutorProfiles.minLeadMinutes,
        timezone: users.timezone,
        suspendedAt: users.suspendedAt,
      })
      .from(tutorProfiles)
      .innerJoin(users, eq(users.id, tutorProfiles.userId))
      .where(eq(tutorProfiles.userId, input.tutorId))
      .limit(1);

    if (!tutor) return { ok: false, problem: 'no_such_tutor' as const };
    if (tutor.status !== 'verified' || tutor.suspendedAt) {
      return { ok: false, problem: 'not_bookable' as const };
    }

    // One standing arrangement per pair. Two would fight over the same slot,
    // and the honest way to teach two subjects is two occurrences a week.
    const [existing] = await tx
      .select({ id: recurringSeries.id })
      .from(recurringSeries)
      .where(
        and(
          eq(recurringSeries.studentId, input.studentId),
          eq(recurringSeries.tutorId, input.tutorId),
          inArray(recurringSeries.status, ['active', 'ending']),
        ),
      )
      .limit(1);

    if (existing) return { ok: false, problem: 'already_running' as const };

    const timezone = tutor.timezone;
    const startsOn = input.startsOn ?? dateInZone(now, timezone);

    // The price the whole arrangement runs at, decided once.
    const { priceCents } = priceForBooking({
      rates: {
        hourlyCents: tutor.hourlyCents,
        halfHourCents: tutor.halfHourCents,
        promoCents: tutor.promoCents,
        promoStartsAt: tutor.promoStartsAt,
        promoEndsAt: tutor.promoEndsAt,
      },
      durationMinutes,
      isTrial: false,
      now,
    });

    const definition = {
      weekdays,
      startTimeLocal: input.startTimeLocal,
      timezone,
      durationMinutes,
      startsOn,
      endsOn: null,
    };

    const horizon = toDateString(
      getLocalParts(new Date(now.getTime() + MATERIALISE_DAYS * 86_400_000), timezone),
    );
    // Past the tutor's own notice period rather than merely in the future.
    // Somebody setting up a Tuesday slot on a Tuesday afternoon is agreeing to
    // every Tuesday from here; that this evening is too short notice for this
    // tutor is not a clash, and refusing the whole arrangement over it would
    // be the wrong answer to the right rule.
    const earliest = new Date(now.getTime() + tutor.minLeadMinutes * 60_000);
    const wanted = occurrencesBetween(definition, startsOn, horizon).filter(
      (occurrence) => occurrence.startUtc > earliest,
    );

    if (wanted.length === 0) return { ok: false, problem: 'not_available' as const };

    // Every one of them has to fit, before anything is written. A series with
    // a hole in week three is not the thing the student agreed to.
    const availability = new DatabaseAvailability(tx);
    const clashes: string[] = [];

    for (const occurrence of wanted) {
      const free = await availability.freeSlotsFor(
        {
          tutorId: input.tutorId,
          durationMinutes,
          fromUtc: new Date(occurrence.startUtc.getTime() - 1),
          toUtc: new Date(occurrence.endUtc.getTime() + 60_000),
          limit: 4,
        },
        now,
      );

      const fits =
        free.known &&
        free.value.some((slot) => slot.startUtc.getTime() === occurrence.startUtc.getTime());

      if (!fits) clashes.push(occurrence.date);
    }

    if (clashes.length > 0) return { ok: false, problem: 'not_available' as const, clashes };

    const [created] = await tx
      .insert(recurringSeries)
      .values({
        studentId: input.studentId,
        tutorId: input.tutorId,
        subjectId: input.subjectId ?? null,
        weekdays,
        startTimeLocal: input.startTimeLocal,
        timezone,
        durationMinutes,
        priceCents,
        startsOn,
        topicNote: (input.topicNote ?? '').trim() || null,
      })
      .returning({ id: recurringSeries.id });

    const seriesId = created!.id;

    // Before materialising, so the first four weeks carry the chapters too.
    await setSeriesTopics(seriesId, input.topicIds ?? [], tx);

    const count = await materialise(seriesId, now, tx);

    await notify(
      {
        userId: input.tutorId,
        kind: 'new_availability',
        title: 'A student booked a standing slot',
        body: `${describeSchedule(weekdays, input.startTimeLocal)} — ${count} sessions are on your calendar.`,
        href: '/tutor',
        dedupeKey: `series:${seriesId}:created`,
      },
      tx,
    );

    return { ok: true as const, seriesId, created: count, priceCents };
  });
}

// ---------------------------------------------------------------------------
// Materialising
// ---------------------------------------------------------------------------

/**
 * Create the `scheduled` bookings for one series, up to the horizon.
 *
 * They hold their slots from the moment they exist — `scheduled` is in
 * `ACTIVE_BOOKING_STATUSES` and in the `booking_no_overlap` index — and they
 * carry no money until their own T-48h.
 *
 * An occurrence whose slot has since been taken by something else is skipped
 * rather than forced. The unique index would refuse it anyway; skipping means
 * the rest of the month still lands.
 */
export async function materialise(
  seriesId: string,
  now: Date,
  tx: DbLike,
): Promise<number> {
  const [series] = await tx.select(SERIES_VIEW).from(recurringSeries).where(eq(recurringSeries.id, seriesId)).limit(1);
  if (!series || series.status === 'ended') return 0;

  const [student] = await tx
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, series.studentId))
    .limit(1);

  const [tutor] = await tx
    .select({
      timezone: users.timezone,
      negotiatedCommissionBps: tutorProfiles.commissionBps,
      minLeadMinutes: tutorProfiles.minLeadMinutes,
    })
    .from(users)
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, users.id))
    .where(eq(users.id, series.tutorId))
    .limit(1);

  if (!student || !tutor) return 0;

  const horizon = toDateString(
    getLocalParts(new Date(now.getTime() + MATERIALISE_DAYS * 86_400_000), series.timezone),
  );

  const wanted = occurrencesBetween(
    {
      weekdays: series.weekdays,
      startTimeLocal: series.startTimeLocal,
      timezone: series.timezone,
      durationMinutes: series.durationMinutes,
      startsOn: series.startsOn,
      endsOn: series.endsOn,
    },
    dateInZone(now, series.timezone),
    horizon,
    // The same notice period `createSeries` validated against, so the job
    // cannot write the one occurrence the check deliberately left out.
  ).filter(
    (occurrence) =>
      occurrence.startUtc.getTime() > now.getTime() + tutor.minLeadMinutes * 60_000,
  );

  // How many occurrences this pair already has, so the first-session rate is
  // charged once across the life of the series rather than once per week.
  const [already] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(bookings)
    .where(eq(bookings.seriesId, seriesId));

  const returning = await hasCompletedPaidSession(series.studentId, series.tutorId, tx);
  // Read once, written onto each occurrence: what the arrangement is for is a
  // property of the arrangement, and the tutor reads it on the session page.
  const topicIds = await seriesTopicIds(seriesId, tx);
  let index = Number(already?.total ?? 0);
  let created = 0;

  for (const occurrence of wanted) {
    const inserted = await insertOccurrence(
      { series, occurrence, index, returning, tutor, student, topicIds },
      tx,
    );

    if (inserted) {
      created += 1;
      index += 1;
    }
  }

  await tx
    .update(recurringSeries)
    .set({ materialisedThrough: horizon, updatedAt: sql`now()` })
    .where(eq(recurringSeries.id, seriesId));

  return created;
}

async function insertOccurrence(
  params: {
    series: SeriesRow;
    occurrence: Occurrence;
    index: number;
    returning: boolean;
    tutor: { timezone: string; negotiatedCommissionBps: number | null; minLeadMinutes: number };
    student: { timezone: string };
    topicIds: readonly string[];
  },
  tx: DbLike,
): Promise<boolean> {
  const { series, occurrence, index, returning, tutor, student, topicIds } = params;

  const rows = await tx
    .insert(bookings)
    .values({
      studentId: series.studentId,
      tutorId: series.tutorId,
      subjectId: series.subjectId,
      isTrial: false,
      seriesId: series.id,
      occurrenceDate: occurrence.date,
      startAtUtc: occurrence.startUtc,
      durationMinutes: series.durationMinutes,
      // Holds the hour. Carries no money until T-48h.
      status: 'scheduled',
      priceCents: series.priceCents,
      commissionBps: commissionForOccurrence(index, returning, tutor.negotiatedCommissionBps),
      studentTz: student.timezone,
      tutorTz: tutor.timezone,
      topicNote: series.topicNote,
    })
    // Two things can refuse this: the occurrence already exists, or the slot is
    // taken by a one-off. Neither is an error worth stopping the month for.
    .onConflictDoNothing()
    .returning({ id: bookings.id });

  const created = rows[0];
  if (!created) return false;

  await tx
    .update(bookings)
    .set({ livekitRoom: `booking_${created.id}` })
    .where(eq(bookings.id, created.id));

  if (topicIds.length > 0) await setBookingTopics(created.id, topicIds, tx);

  return true;
}

// ---------------------------------------------------------------------------
// The jobs
// ---------------------------------------------------------------------------

export type SeriesJobReport = {
  rolled: number;
  created: number;
  warned: number;
  charged: number;
  lapsed: number;
  closed: number;
};

/**
 * Roll every live series forward, then move the money that is due.
 *
 * Written to be run often — every hour is right, and running it every minute
 * would be harmless. Each step is idempotent: materialisation by a unique
 * index, warnings by a notification dedupe key, charging by the booking's own
 * status transition.
 */
export async function runSeriesJobs(
  now = new Date(),
  database: Database = defaultDb,
): Promise<SeriesJobReport> {
  const report: SeriesJobReport = { rolled: 0, created: 0, warned: 0, charged: 0, lapsed: 0, closed: 0 };

  const live = await database
    .select({ id: recurringSeries.id })
    .from(recurringSeries)
    .where(inArray(recurringSeries.status, ['active', 'ending']))
    .orderBy(asc(recurringSeries.createdAt));

  for (const series of live) {
    report.created += await database.transaction((tx) => materialise(series.id, now, tx));
    report.rolled += 1;
  }

  report.closed = await closeFinishedSeries(now, database);
  const money = await chargeDueOccurrences(now, database);

  return { ...report, ...money };
}

/** A series whose end date has passed stops being live. */
async function closeFinishedSeries(now: Date, database: Database): Promise<number> {
  const rows = await database
    .update(recurringSeries)
    .set({ status: 'ended', updatedAt: sql`now()` })
    .where(
      sql`${recurringSeries.status} = 'ending'
          and ${recurringSeries.endsOn} is not null
          and ${recurringSeries.endsOn} < (${now.toISOString()}::timestamptz at time zone ${recurringSeries.timezone})::date`,
    )
    .returning({ id: recurringSeries.id });

  return rows.length;
}

/**
 * Warn at T-72h, charge at T-48h, lapse what cannot be paid for.
 *
 * The three happen in one pass over the same rows because they are the same
 * question asked at three moments, and splitting them into three jobs would
 * mean three chances for one of them to stop running unnoticed.
 */
export async function chargeDueOccurrences(
  now = new Date(),
  database: Database = defaultDb,
): Promise<{ warned: number; charged: number; lapsed: number }> {
  const due = await database
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      seriesId: bookings.seriesId,
      startAtUtc: bookings.startAtUtc,
      priceCents: bookings.priceCents,
      studentName: users.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.studentId))
    .where(
      and(
        eq(bookings.status, 'scheduled'),
        // Everything starting inside the warning window, so one query answers
        // all three questions. `WARN_HOURS_BEFORE` rather than a literal,
        // because the window and the warning are the same number by definition.
        //
        // There is deliberately no lower bound. An occurrence still `scheduled`
        // with its start time behind us means this job did not run for two
        // days; those cannot happen and nobody paid for them, so they are swept
        // up below rather than left holding a slot forever.
        sql`${bookings.startAtUtc} <= ${new Date(now.getTime() + WARN_HOURS_BEFORE * 3_600_000).toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(bookings.startAtUtc));

  let warned = 0;
  let charged = 0;
  let lapsed = 0;

  for (const booking of due) {
    const chargeAt = chargeDueAt(booking.startAtUtc);
    const warnAt = warnDueAt(booking.startAtUtc);

    if (now < warnAt) continue;

    // Already gone. Never charged, so nothing to refund; lapse it and free the
    // hour rather than pretending a session in the past is still coming.
    if (booking.startAtUtc <= now) {
      await database.transaction((tx) => moveBookingStatus(booking.id, 'lapsed', { cancelledAt: now }, tx));
      lapsed += 1;
      continue;
    }

    const [wallet] = await database
      .select({ creditsCents: studentWallets.creditsCents })
      .from(studentWallets)
      .where(eq(studentWallets.userId, booking.studentId))
      .limit(1);

    const covered = (wallet?.creditsCents ?? 0) >= booking.priceCents;

    if (now < chargeAt) {
      // Still in the warning window. Say something only if they are short.
      if (!covered) {
        await notify(
          {
            userId: booking.studentId,
            kind: 'series_short',
            title: 'Top up before your next session',
            body: `Your next session costs ${formatCents(booking.priceCents)} and your balance will not cover it. We take it 48 hours before, and without it the session will not go ahead.`,
            href: '/credits',
            dedupeKey: `series:short:${booking.id}`,
          },
          database,
        );

        // The warning is the one message in the series flow that has to reach
        // somebody who is not on the site: at T-48h they still have time to top
        // up, and at T-48h+1s they do not.
        await emailCreditsLow(
          {
            userId: booking.studentId,
            balanceCents: wallet?.creditsCents ?? 0,
            occurrenceId: booking.id,
          },
          database,
        );

        warned += 1;
      }
      continue;
    }

    if (covered) {
      await database.transaction(async (tx) => {
        await moveBookingStatus(booking.id, 'confirmed', {}, tx);
        await appendLedger(
          tx,
          bookingEscrowEntries({
            bookingId: booking.id,
            studentId: booking.studentId,
            priceCents: booking.priceCents,
          }),
        );
      });
      await emailBookingConfirmed(booking.id, database);
      charged += 1;
      continue;
    }

    // Out of time and out of credits. It lapses, and both sides are told —
    // a session that quietly disappears from a calendar is worse than one
    // that is cancelled out loud.
    await database.transaction(async (tx) => {
      await moveBookingStatus(booking.id, 'lapsed', { cancelledAt: now }, tx);

      await notify(
        {
          userId: booking.studentId,
          kind: 'series_lapsed',
          title: 'A session did not go ahead',
          body: `There were not enough credits to cover it 48 hours before. Your standing slot is untouched — top up and the next one runs as normal.`,
          href: '/credits',
          dedupeKey: `series:lapsed:${booking.id}`,
        },
        tx,
      );

      await notify(
        {
          userId: booking.tutorId,
          kind: 'series_lapsed',
          title: 'A recurring session lapsed',
          body: `${booking.studentName ?? 'A student'} did not have credits in time. The slot is free, and their standing arrangement carries on.`,
          href: '/tutor',
          dedupeKey: `series:lapsed:tutor:${booking.id}`,
        },
        tx,
      );
    });

    lapsed += 1;
  }

  return { warned, charged, lapsed };
}

// ---------------------------------------------------------------------------
// Ending
// ---------------------------------------------------------------------------

export type EndSeriesResult = { ok: true; endsOn: string; cancelled: number } | { ok: false; reason: string };

/**
 * End a standing arrangement, with seven days' notice.
 *
 * Occurrences inside the notice period are left alone: somebody planned around
 * them. Everything after it is cancelled, and because those are all more than
 * a week out they are all still `scheduled` — no money has moved, so there is
 * nothing to refund and nobody is charged a late fee for somebody else's
 * decision.
 */
export async function endSeries(
  seriesId: string,
  by: 'student' | 'tutor' | 'admin',
  actorId: string,
  reason: string | null,
  now = new Date(),
  database: Database = defaultDb,
): Promise<EndSeriesResult> {
  return database.transaction(async (tx) => {
    const [series] = await tx.select(SERIES_VIEW).from(recurringSeries).where(eq(recurringSeries.id, seriesId)).limit(1);

    if (!series) return { ok: false as const, reason: 'That arrangement could not be found.' };
    if (series.status === 'ended') return { ok: false as const, reason: 'That arrangement has already ended.' };

    // Row-level authorization, here rather than at the route.
    const allowed =
      by === 'admin' ||
      (by === 'student' && series.studentId === actorId) ||
      (by === 'tutor' && series.tutorId === actorId);

    if (!allowed) return { ok: false as const, reason: 'That arrangement could not be found.' };

    const endsOn = noticeEndsOn(dateInZone(now, series.timezone));

    await tx
      .update(recurringSeries)
      .set({
        status: 'ending',
        endsOn,
        endedBy: by,
        endedAt: now,
        endReason: reason?.slice(0, 2_000) ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(recurringSeries.id, seriesId));

    // Everything past the notice date goes. They are all unpaid.
    const doomed = await tx
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(
        and(
          eq(bookings.seriesId, seriesId),
          eq(bookings.status, 'scheduled'),
          sql`${bookings.occurrenceDate} > ${endsOn}::date`,
        ),
      );

    for (const booking of doomed) {
      await moveBookingStatus(
        booking.id,
        by === 'tutor' ? 'cancelled_by_tutor' : 'cancelled_by_student',
        { cancelledAt: now, cancelledBy: by === 'admin' ? 'admin' : by },
        tx,
      );
    }

    const other = by === 'tutor' ? series.studentId : series.tutorId;
    await notify(
      {
        userId: other,
        kind: 'series_ending',
        title: 'A standing arrangement is ending',
        body: `${describeSchedule(series.weekdays, series.startTimeLocal)} runs until ${endsOn}.${reason ? ` Reason: ${reason}` : ''}`,
        href: by === 'tutor' ? '/dashboard' : '/tutor',
        dedupeKey: `series:${seriesId}:ending`,
      },
      tx,
    );

    return { ok: true as const, endsOn, cancelled: doomed.length };
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type SeriesView = SeriesRow & {
  studentName: string | null;
  tutorName: string | null;
  /** Upcoming occurrences that still exist as rows. */
  upcoming: { bookingId: string; startAtUtc: Date; status: string; priceCents: number }[];
  sessionsPerWeek: number;
  /** The chapters it is for, as they read on the syllabus. */
  topics: { id: string; name: string; reference: string | null }[];
};

export async function seriesFor(
  userId: string,
  role: 'student' | 'tutor',
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<SeriesView[]> {
  const rows = await database
    .select({
      ...SERIES_VIEW,
      studentName: sql<string | null>`(select name from users where id = ${recurringSeries.studentId})`,
      tutorName: sql<string | null>`(select name from users where id = ${recurringSeries.tutorId})`,
    })
    .from(recurringSeries)
    .where(
      and(
        role === 'student'
          ? eq(recurringSeries.studentId, userId)
          : eq(recurringSeries.tutorId, userId),
        inArray(recurringSeries.status, ['active', 'ending']),
      ),
    )
    .orderBy(asc(recurringSeries.createdAt));

  if (rows.length === 0) return [];

  const occurrences = await database
    .select({
      seriesId: bookings.seriesId,
      bookingId: bookings.id,
      startAtUtc: bookings.startAtUtc,
      status: bookings.status,
      priceCents: bookings.priceCents,
    })
    .from(bookings)
    .where(
      and(
        inArray(
          bookings.seriesId,
          rows.map((row) => row.id),
        ),
        sql`${bookings.startAtUtc} > ${now.toISOString()}::timestamptz`,
        inArray(bookings.status, ['scheduled', 'confirmed', 'in_progress']),
      ),
    )
    .orderBy(asc(bookings.startAtUtc));

  const chapters = await database
    .select({
      seriesId: seriesTopics.seriesId,
      id: topics.id,
      name: topics.name,
      reference: topics.reference,
      sortOrder: topics.sortOrder,
    })
    .from(seriesTopics)
    .innerJoin(topics, eq(topics.id, seriesTopics.topicId))
    .where(
      inArray(
        seriesTopics.seriesId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(topics.sortOrder), asc(topics.name));

  return rows.map((row) => ({
    ...(row as unknown as SeriesRow & { studentName: string | null; tutorName: string | null }),
    sessionsPerWeek: row.weekdays.length,
    topics: chapters
      .filter((chapter) => chapter.seriesId === row.id)
      .map((chapter) => ({ id: chapter.id, name: chapter.name, reference: chapter.reference })),
    upcoming: occurrences
      .filter((occurrence) => occurrence.seriesId === row.id)
      .map((occurrence) => ({
        bookingId: occurrence.bookingId,
        startAtUtc: occurrence.startAtUtc,
        status: occurrence.status,
        priceCents: occurrence.priceCents,
      })),
  }));
}

/** One series, for the page that manages it. Scoped to somebody who is in it. */
export async function seriesForViewer(
  seriesId: string,
  viewerId: string,
  database: DbLike = defaultDb,
): Promise<SeriesRow | null> {
  const [row] = await database
    .select(SERIES_VIEW)
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.id, seriesId),
        sql`(${recurringSeries.studentId} = ${viewerId}::uuid or ${recurringSeries.tutorId} = ${viewerId}::uuid)`,
      ),
    )
    .limit(1);

  return (row as unknown as SeriesRow | undefined) ?? null;
}
