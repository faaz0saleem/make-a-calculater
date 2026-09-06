/**
 * Free trials (SPEC.md §6).
 *
 * A trial is a booking with `is_trial = true`, priced at zero, with no escrow
 * row and no ledger entries — nothing here touches money, and that is the
 * point. What it does touch is a tutor's calendar, so it goes through the same
 * availability engine and the same partial unique index as a paid booking.
 *
 * Two guarantees live in the database rather than in this file:
 *
 *  - `one_trial_per_pair` — one free trial per student-tutor pair, for life.
 *  - `booking_no_overlap` — a tutor holds one live booking per start time.
 *
 * Both are unique indexes. The checks below exist to give a person a decent
 * error message; the indexes exist because two clicks can race and a check
 * cannot.
 */

import { and, asc, count, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';

import { commissionBpsFor } from '@/lib/money/commission';
import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { emailTrialDecision, emailTrialRequested } from './email-events';
import { notify } from './notifications';
import { isUserRestricted } from './reports';
import { moveBookingStatus } from './sessions';
import { bookings, threads, tutorProfiles, users } from './schema';
import { getAvailability } from '@/lib/availability';
import {
  TRIAL_BUFFER_MINUTES,
  isTrialRequestExpired,
  trialExpiresAt,
  trialRequestProblem,
  weekWindowStart,
  type TrialRequestProblem,
} from '@/lib/trials/rules';

export type TrialRequestFailure = TrialRequestProblem | 'slot_taken' | 'not_available' | 'no_such_tutor';

export type TrialRequestResult =
  | { ok: true; bookingId: string; startAtUtc: Date; durationMinutes: number }
  | { ok: false; problem: TrialRequestFailure };

/**
 * Expire pending trial requests that have run out of time.
 *
 * Called at the top of every read and every write that cares — SPEC.md §6 says
 * expiry is checked at read time, not by a sweeper, because a job that runs
 * every five minutes leaves five minutes in which a tutor can accept something
 * already dead.
 *
 * Each row goes through `transitionBooking`; a bulk UPDATE would be faster and
 * would also be the one place in the codebase that writes a status without the
 * state machine.
 */
export async function expireStaleTrialRequests(
  scope: { studentId?: string; tutorId?: string },
  now: Date,
  database: DbLike = defaultDb,
): Promise<number> {
  const filters = [eq(bookings.isTrial, true), eq(bookings.status, 'pending_tutor')];
  if (scope.studentId) filters.push(eq(bookings.studentId, scope.studentId));
  if (scope.tutorId) filters.push(eq(bookings.tutorId, scope.tutorId));

  const pending = await database
    .select({ id: bookings.id, createdAt: bookings.createdAt, startAtUtc: bookings.startAtUtc })
    .from(bookings)
    .where(and(...filters));

  const dead = pending.filter((row) =>
    isTrialRequestExpired({ requestedAt: row.createdAt, startAtUtc: row.startAtUtc }, now),
  );

  for (const row of dead) {
    await moveBookingStatus(row.id, 'expired', {}, database);
  }

  return dead.length;
}

/** Everything the guards need to count, in one round trip. */
async function gatherFacts(
  studentId: string,
  tutorId: string,
  now: Date,
  database: DbLike,
): Promise<{
  pairHasTrial: boolean;
  outstandingRequests: number;
  trialsThisWeek: number;
  tutorTrialsThisWeek: number;
}> {
  const weekStart = weekWindowStart(now);

  const [pair] = await database
    .select({ total: count() })
    .from(bookings)
    .where(and(eq(bookings.isTrial, true), eq(bookings.studentId, studentId), eq(bookings.tutorId, tutorId)));

  const [outstanding] = await database
    .select({ total: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.isTrial, true),
        eq(bookings.studentId, studentId),
        eq(bookings.status, 'pending_tutor'),
      ),
    );

  const [week] = await database
    .select({ total: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.isTrial, true),
        eq(bookings.studentId, studentId),
        gte(bookings.createdAt, weekStart),
        // A request the tutor turned down does not use up the student's week.
        ne(bookings.status, 'cancelled_by_tutor'),
      ),
    );

  const [tutorWeek] = await database
    .select({ total: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.isTrial, true),
        eq(bookings.tutorId, tutorId),
        gte(bookings.startAtUtc, weekStart),
        inArray(bookings.status, ['pending_tutor', 'confirmed', 'in_progress', 'completed', 'settled']),
      ),
    );

  return {
    pairHasTrial: (pair?.total ?? 0) > 0,
    outstandingRequests: outstanding?.total ?? 0,
    trialsThisWeek: week?.total ?? 0,
    tutorTrialsThisWeek: tutorWeek?.total ?? 0,
  };
}

/**
 * Ask a tutor for a free trial.
 *
 * The slot is checked against the real availability engine for the trial's own
 * length, so a 15-minute trial can sit in a gap a 60-minute session could not.
 */
export async function requestTrial(
  input: { studentId: string; tutorId: string; startAtUtc: Date; subjectId?: string | null },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<TrialRequestResult> {
  const [tutor] = await database
    .select({
      userId: tutorProfiles.userId,
      status: tutorProfiles.status,
      offersTrial: tutorProfiles.offersTrial,
      trialMinutes: tutorProfiles.trialMinutes,
      maxTrialsPerWeek: tutorProfiles.maxTrialsPerWeek,
      commissionBps: tutorProfiles.commissionBps,
      timezone: users.timezone,
      subjectId: sql<string | null>`null`,
    })
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .where(eq(tutorProfiles.userId, input.tutorId))
    .limit(1);

  if (!tutor) return { ok: false, problem: 'no_such_tutor' };

  const [student] = await database
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, input.studentId))
    .limit(1);

  if (!student) return { ok: false, problem: 'no_such_tutor' };

  // Counts have to be taken after the dead requests are cleared, or a student
  // stays blocked by three requests that all timed out yesterday.
  await expireStaleTrialRequests({ studentId: input.studentId }, now, database);
  await expireStaleTrialRequests({ tutorId: input.tutorId }, now, database);

  const facts = await gatherFacts(input.studentId, input.tutorId, now, database);

  const problem = trialRequestProblem(
    {
      offersTrial: tutor.offersTrial,
      verified: tutor.status === 'verified',
      // A restricted tutor keeps every student they have and loses only the
      // next one. See `lib/moderation/sanctions.ts` for why it is that way round.
      tutorRestricted: await isUserRestricted(input.tutorId, database, now),
      maxTrialsPerWeek: tutor.maxTrialsPerWeek,
      isSelf: input.studentId === input.tutorId,
      startAtUtc: input.startAtUtc,
      ...facts,
    },
    now,
  );

  if (problem) return { ok: false, problem };

  // The slot has to be one the engine would actually offer. The window has to
  // contain the whole slot, not just its start, or the engine correctly answers
  // "nothing fits in there" and every request looks taken.
  const heldMinutes = tutor.trialMinutes + TRIAL_BUFFER_MINUTES;
  const slots = await getAvailability().freeSlotsFor({
    tutorId: input.tutorId,
    durationMinutes: heldMinutes,
    fromUtc: new Date(input.startAtUtc.getTime() - 1),
    toUtc: new Date(input.startAtUtc.getTime() + (heldMinutes + 1) * 60_000),
    limit: 4,
  });

  if (!slots.known || !slots.value.some((slot) => slot.startUtc.getTime() === input.startAtUtc.getTime())) {
    return { ok: false, problem: 'not_available' };
  }

  try {
    const [created] = await database
      .insert(bookings)
      .values({
        studentId: input.studentId,
        tutorId: input.tutorId,
        subjectId: input.subjectId ?? null,
        isTrial: true,
        startAtUtc: input.startAtUtc,
        durationMinutes: tutor.trialMinutes,
        status: 'pending_tutor',
        priceCents: 0,
        // A trial is free and moves no money, but the column is not nullable
        // and a zero would read as "we took nothing from a paid session".
        // Snapshot what a first paid booking would have carried.
        commissionBps: commissionBpsFor(false, tutor.commissionBps),
        escrowCents: 0,
        studentTz: student.timezone,
        tutorTz: tutor.timezone,
      })
      .returning({ id: bookings.id });

    if (!created) return { ok: false, problem: 'slot_taken' };

    // A thread exists from the moment there is a reason to talk (SPEC.md §8).
    await ensureThread(input.studentId, input.tutorId, database);

    await notify(
      {
        userId: input.tutorId,
        kind: 'trial_requested',
        title: 'New free trial request',
        body: `${tutor.trialMinutes} minutes. You have 12 hours to accept or decline.`,
        href: '/tutor',
        dedupeKey: `trial:${created.id}:requested`,
      },
      database,
    );

    // The bell is only useful to somebody already on the site. A trial request
    // a tutor does not answer inside twelve hours expires, so the message that
    // reaches them where they are is the one that decides whether it happens.
    await emailTrialRequested(
      { bookingId: created.id, expiresAt: trialExpiresAt(now, input.startAtUtc) },
      database,
    );

    return {
      ok: true,
      bookingId: created.id,
      startAtUtc: input.startAtUtc,
      durationMinutes: tutor.trialMinutes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('one_trial_per_pair')) return { ok: false, problem: 'already_used' };
    if (message.includes('booking_no_overlap')) return { ok: false, problem: 'slot_taken' };
    throw error;
  }
}

/** A thread per student-tutor pair, created only when there is a reason. */
export async function ensureThread(
  studentId: string,
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<string> {
  const [created] = await database
    .insert(threads)
    .values({ studentId, tutorId })
    .onConflictDoNothing({ target: [threads.studentId, threads.tutorId] })
    .returning({ id: threads.id });

  if (created) return created.id;

  const [existing] = await database
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.studentId, studentId), eq(threads.tutorId, tutorId)))
    .limit(1);

  return existing!.id;
}

export type TrialDecision = 'accept' | 'decline';

export type TrialDecisionResult =
  | { ok: true; status: 'confirmed' | 'cancelled_by_tutor' }
  | { ok: false; reason: 'not_found' | 'not_yours' | 'expired' | 'already_answered' };

/**
 * The tutor answers.
 *
 * Expiry is re-checked here rather than trusted from the page that rendered the
 * button: the twelve hours may well have run out while the tab was open.
 */
export async function decideTrial(
  bookingId: string,
  tutorId: string,
  decision: TrialDecision,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<TrialDecisionResult> {
  const [booking] = await database
    .select({
      id: bookings.id,
      tutorId: bookings.tutorId,
      studentId: bookings.studentId,
      status: bookings.status,
      isTrial: bookings.isTrial,
      createdAt: bookings.createdAt,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.isTrial, true)))
    .limit(1);

  if (!booking) return { ok: false, reason: 'not_found' };
  if (booking.tutorId !== tutorId) return { ok: false, reason: 'not_yours' };
  if (booking.status !== 'pending_tutor') return { ok: false, reason: 'already_answered' };

  if (isTrialRequestExpired({ requestedAt: booking.createdAt, startAtUtc: booking.startAtUtc }, now)) {
    await moveBookingStatus(booking.id, 'expired', {}, database);
    await notify(
      {
        userId: booking.studentId,
        kind: 'trial_expired',
        title: 'A trial request expired',
        body: 'Your tutor did not answer in time. Nothing was charged — try another slot.',
        href: '/dashboard',
        dedupeKey: `trial:${booking.id}:expired`,
      },
      database,
    );
    return { ok: false, reason: 'expired' };
  }

  const status = decision === 'accept' ? 'confirmed' : 'cancelled_by_tutor';

  await moveBookingStatus(
    booking.id,
    status,
    decision === 'decline' ? { cancelledAt: now, cancelledBy: 'tutor' } : {},
    database,
  );

  await notify(
    {
      userId: booking.studentId,
      kind: decision === 'accept' ? 'trial_accepted' : 'trial_declined',
      title: decision === 'accept' ? 'Your free trial is confirmed' : 'Your trial request was declined',
      body:
        decision === 'accept'
          ? `${booking.durationMinutes} minutes. The room opens five minutes before it starts.`
          : 'Nothing was charged, and your free trial with this tutor is still available.',
      href: decision === 'accept' ? `/sessions/${booking.id}` : '/dashboard',
      dedupeKey: `trial:${booking.id}:${decision}`,
    },
    database,
  );

  await emailTrialDecision(
    {
      bookingId: booking.id,
      decision: decision === 'accept' ? 'accepted' : 'declined',
      // The tutor declines with one tap and no box to type in, so there is
      // no reason to pass on. The template says so rather than inventing one.
      reason: null,
    },
    database,
  );

  return { ok: true, status };
}

export type PendingTrial = {
  id: string;
  studentId: string;
  studentName: string;
  tutorId: string;
  tutorName: string;
  startAtUtc: Date;
  durationMinutes: number;
  createdAt: Date;
  expiresAt: Date;
  /** Present on the tutor's side, where it changes whether they accept. */
  topicNote?: string | null;
  topics?: string | null;
};

/** A tutor's unanswered requests, dead ones already cleared. */
export async function pendingTrialsForTutor(
  tutorId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<PendingTrial[]> {
  await expireStaleTrialRequests({ tutorId }, now, database);

  const rows = await database
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      studentName: users.name,
      tutorId: bookings.tutorId,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      createdAt: bookings.createdAt,
      // What the student wants out of it. A tutor deciding whether to accept a
      // free trial is deciding whether they can help with *this*, and the
      // answer changes the decision — so it is on the request, not behind it.
      topicNote: bookings.topicNote,
      topics: sql<string | null>`(
        select string_agg(t.name, ', ' order by t.sort_order)
        from booking_topics bt join topics t on t.id = bt.topic_id
        where bt.booking_id = ${bookings.id}
      )`,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.studentId))
    .where(
      and(eq(bookings.tutorId, tutorId), eq(bookings.isTrial, true), eq(bookings.status, 'pending_tutor')),
    )
    .orderBy(asc(bookings.startAtUtc));

  return rows.map((row) => ({
    ...row,
    tutorName: '',
    expiresAt: trialExpiresAt(row.createdAt, row.startAtUtc),
  }));
}

/** A student's outstanding requests, dead ones already cleared. */
export async function pendingTrialsForStudent(
  studentId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<PendingTrial[]> {
  await expireStaleTrialRequests({ studentId }, now, database);

  const rows = await database
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      tutorName: users.name,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.tutorId))
    .where(
      and(eq(bookings.studentId, studentId), eq(bookings.isTrial, true), eq(bookings.status, 'pending_tutor')),
    )
    .orderBy(asc(bookings.startAtUtc));

  return rows.map((row) => ({
    ...row,
    studentName: '',
    expiresAt: trialExpiresAt(row.createdAt, row.startAtUtc),
  }));
}

export type TrialToConvert = {
  bookingId: string;
  tutorId: string;
  tutorName: string;
  completedAt: Date;
  hourlyCents: number;
  halfHourCents: number;
};

/**
 * A trial this student took recently and has not yet followed with a paid
 * session (SPEC.md §6).
 *
 * The classroom shows the conversion screen the moment a trial ends, but people
 * close tabs. This is the same moment, still available on the dashboard for the
 * week afterwards — and it disappears as soon as they book, so it never nags
 * somebody who already said yes.
 */
export async function recentTrialToConvert(
  studentId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<TrialToConvert | null> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000);

  const rows = await database
    .select({
      bookingId: bookings.id,
      tutorId: bookings.tutorId,
      tutorName: users.name,
      completedAt: bookings.completedAt,
      hourlyCents: tutorProfiles.hourlyCents,
      halfHourCents: tutorProfiles.halfHourCents,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.tutorId))
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, bookings.tutorId))
    .where(
      and(
        eq(bookings.studentId, studentId),
        eq(bookings.isTrial, true),
        gte(bookings.completedAt, since),
        // A paid session with them since the trial — booked, or still to come —
        // means the conversion already happened and there is nothing to ask for.
        sql`not exists (
          select 1 from bookings paid
          where paid.student_id = ${studentId}
            and paid.tutor_id = ${bookings.tutorId}
            and not paid.is_trial
            and paid.status not in ('cancelled_by_student', 'cancelled_by_tutor', 'expired')
            and paid.start_at_utc > ${bookings.completedAt}
        )`,
      ),
    )
    .orderBy(desc(bookings.completedAt))
    .limit(1);

  const row = rows[0];
  if (!row?.completedAt) return null;

  return { ...row, completedAt: row.completedAt };
}

/** Whether this pair has ever had a trial, for the profile CTA. */
export async function pairHasHadTrial(
  studentId: string,
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const [row] = await database
    .select({ total: count() })
    .from(bookings)
    .where(and(eq(bookings.isTrial, true), eq(bookings.studentId, studentId), eq(bookings.tutorId, tutorId)));

  return (row?.total ?? 0) > 0;
}
