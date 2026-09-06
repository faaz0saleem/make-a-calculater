/**
 * Chapters, what a session was for, and what it covered (SPEC.md §4, §9).
 *
 * Nobody teaches a whole syllabus in an hour, so a booking says what it is
 * for. That does three jobs at once, and only the first is obvious:
 *
 *  1. The tutor knows what to prepare — and for a trial, knows before they
 *     accept it, which is when the answer actually changes their decision.
 *  2. Afterwards the tutor marks what was really covered, which is not the
 *     same list. A session booked for three chapters that got through one is a
 *     normal session; recording it as three would make the progress view a lie.
 *  3. **It is the retention engine.** A student looking at fourteen of
 *     twenty-two chapters covered has a reason to book the fifteenth, and that
 *     is a better reason than a discount.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { bookingTopics, bookings, topics, tutorTopics } from './schema';
import { MAX_TOPICS_PER_BOOKING } from './schema';

export { MAX_TOPICS_PER_BOOKING };

export type Topic = {
  id: string;
  boardId: string;
  levelId: string;
  subjectId: string;
  name: string;
  reference: string | null;
  sortOrder: number;
};

/** The chapters offered for one curriculum position. Empty is a real answer. */
export async function topicsForPosition(
  position: { boardId: string; levelId: string; subjectId: string },
  database: DbLike = defaultDb,
): Promise<Topic[]> {
  return database
    .select({
      id: topics.id,
      boardId: topics.boardId,
      levelId: topics.levelId,
      subjectId: topics.subjectId,
      name: topics.name,
      reference: topics.reference,
      sortOrder: topics.sortOrder,
    })
    .from(topics)
    .where(
      and(
        eq(topics.boardId, position.boardId),
        eq(topics.levelId, position.levelId),
        eq(topics.subjectId, position.subjectId),
        eq(topics.isActive, true),
      ),
    )
    .orderBy(asc(topics.sortOrder), asc(topics.name));
}

/**
 * The chapters to offer a student booking this tutor.
 *
 * Taken from the student's own declared positions, narrowed to the subject if
 * one was picked — a student studying CAIE A Level Chemistry should not be
 * shown CBSE Class 9 Biology chapters just because their tutor teaches both.
 */
export async function topicsForStudent(
  studentId: string,
  subjectId: string | null,
  database: DbLike = defaultDb,
): Promise<(Topic & { subjectName: string; levelName: string; boardName: string })[]> {
  const rows = (await database.execute(sql`
    select
      t.id::text, t.board_id, t.level_id, t.subject_id::text, t.name, t.reference, t.sort_order,
      s.name as subject_name, cl.name as level_name, b.name as board_name
    from student_curriculum sc
    join topics t
      on t.board_id = sc.board_id and t.level_id = sc.level_id and t.subject_id = sc.subject_id
    join subjects s on s.id = t.subject_id
    join curriculum_levels cl on cl.id = t.level_id and cl.board_id = t.board_id
    join boards b on b.id = t.board_id
    where sc.student_id = ${studentId}::uuid
      and t.is_active
      ${subjectId ? sql`and t.subject_id = ${subjectId}::uuid` : sql``}
    order by sc.is_primary desc, s.name, t.sort_order, t.name
  `)) as unknown as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    boardId: String(row.board_id),
    levelId: String(row.level_id),
    subjectId: String(row.subject_id),
    name: String(row.name),
    reference: (row.reference as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    subjectName: String(row.subject_name),
    levelName: String(row.level_name),
    boardName: String(row.board_name),
  }));
}

/**
 * Attach the chapters a student picked to a booking.
 *
 * Replaces whatever was there, so editing before the session is one call. The
 * cap is enforced here rather than only in the form: five chapters is already
 * more than an hour holds, and a booking with forty attached is somebody
 * ticking every box rather than saying what they need.
 */
export async function setBookingTopics(
  bookingId: string,
  topicIds: readonly string[],
  database: DbLike = defaultDb,
): Promise<void> {
  const wanted = [...new Set(topicIds)].slice(0, MAX_TOPICS_PER_BOOKING);

  await database.delete(bookingTopics).where(eq(bookingTopics.bookingId, bookingId));
  if (wanted.length === 0) return;

  await database
    .insert(bookingTopics)
    .values(wanted.map((topicId) => ({ bookingId, topicId })))
    .onConflictDoNothing();
}

export type BookingTopic = {
  topicId: string;
  name: string;
  reference: string | null;
  covered: boolean | null;
  grasp: string | null;
};

/** What one booking is for, and what the tutor said about it afterwards. */
export async function topicsOnBooking(
  bookingId: string,
  database: DbLike = defaultDb,
): Promise<BookingTopic[]> {
  return database
    .select({
      topicId: bookingTopics.topicId,
      name: topics.name,
      reference: topics.reference,
      covered: bookingTopics.covered,
      grasp: bookingTopics.grasp,
    })
    .from(bookingTopics)
    .innerJoin(topics, eq(topics.id, bookingTopics.topicId))
    .where(eq(bookingTopics.bookingId, bookingId))
    .orderBy(asc(topics.sortOrder), asc(topics.name)) as unknown as Promise<BookingTopic[]>;
}

export type CoverageMark = {
  topicId: string;
  covered: boolean;
  grasp?: 'struggling' | 'developing' | 'secure' | null;
};

/**
 * The tutor's account of what actually happened.
 *
 * Only the tutor on the booking may write it, checked here rather than at the
 * route, and only once the session has happened — marking a chapter covered
 * before the lesson is not a thing that can be true.
 */
export async function markCoverage(
  bookingId: string,
  tutorId: string,
  marks: readonly CoverageMark[],
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const [booking] = await database
    .select({ tutorId: bookings.tutorId, status: bookings.status, completedAt: bookings.completedAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking || booking.tutorId !== tutorId) {
    return { ok: false, reason: 'That session could not be found.' };
  }

  if (!booking.completedAt) {
    return { ok: false, reason: 'You can record what was covered once the session has happened.' };
  }

  for (const mark of marks) {
    await database
      .update(bookingTopics)
      .set({ covered: mark.covered, grasp: mark.grasp ?? null, markedAt: now })
      .where(
        and(eq(bookingTopics.bookingId, bookingId), eq(bookingTopics.topicId, mark.topicId)),
      );
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type ProgressRow = {
  topicId: string;
  name: string;
  reference: string | null;
  covered: boolean;
  grasp: string | null;
  lastCoveredAt: Date | null;
  timesBooked: number;
};

export type Progress = {
  boardName: string;
  levelName: string;
  subjectName: string;
  rows: ProgressRow[];
  coveredCount: number;
  totalCount: number;
};

/**
 * Covered against remaining, for one student and one tutor.
 *
 * Every chapter in the student's declared positions is a row, whether or not it
 * has ever been booked — a progress view that only listed what somebody had
 * already done would show nothing on day one and would never show what is
 * left, which is the half that makes them book again.
 */
export async function progressFor(
  studentId: string,
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<Progress[]> {
  const rows = (await database.execute(sql`
    select
      b.name as board_name,
      cl.name as level_name,
      s.name as subject_name,
      t.id::text as topic_id,
      t.name,
      t.reference,
      t.sort_order,
      coalesce(bool_or(bt.covered), false) as covered,
      (array_agg(bt.grasp order by bt.marked_at desc nulls last))[1] as grasp,
      max(bt.marked_at) as last_covered_at,
      count(bt.booking_id)::int as times_booked
    from student_curriculum sc
    join topics t
      on t.board_id = sc.board_id and t.level_id = sc.level_id and t.subject_id = sc.subject_id
    join subjects s on s.id = t.subject_id
    join curriculum_levels cl on cl.id = t.level_id and cl.board_id = t.board_id
    join boards b on b.id = t.board_id
    left join booking_topics bt on bt.topic_id = t.id
    left join bookings bk
      on bk.id = bt.booking_id and bk.student_id = sc.student_id and bk.tutor_id = ${tutorId}::uuid
    where sc.student_id = ${studentId}::uuid
      and t.is_active
      and (bt.booking_id is null or bk.id is not null)
    group by b.name, cl.name, s.name, t.id, t.name, t.reference, t.sort_order
    order by s.name, t.sort_order, t.name
  `)) as unknown as Record<string, unknown>[];

  const groups = new Map<string, Progress>();

  for (const row of rows) {
    const key = `${String(row.board_name)}|${String(row.level_name)}|${String(row.subject_name)}`;
    const group =
      groups.get(key) ??
      {
        boardName: String(row.board_name),
        levelName: String(row.level_name),
        subjectName: String(row.subject_name),
        rows: [],
        coveredCount: 0,
        totalCount: 0,
      };

    const covered = row.covered === true;
    group.rows.push({
      topicId: String(row.topic_id),
      name: String(row.name),
      reference: (row.reference as string | null) ?? null,
      covered,
      grasp: (row.grasp as string | null) ?? null,
      lastCoveredAt: row.last_covered_at ? new Date(row.last_covered_at as string) : null,
      timesBooked: Number(row.times_booked ?? 0),
    });

    group.totalCount += 1;
    if (covered) group.coveredCount += 1;
    groups.set(key, group);
  }

  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Tutor strengths
// ---------------------------------------------------------------------------

/** Chapters a tutor says they are strong on. A tiebreak, never a tier. */
export async function tutorTopicIds(
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<string[]> {
  const rows = await database
    .select({ topicId: tutorTopics.topicId })
    .from(tutorTopics)
    .where(eq(tutorTopics.tutorId, tutorId));

  return rows.map((row) => row.topicId);
}

export async function setTutorTopics(
  tutorId: string,
  topicIds: readonly string[],
  database: DbLike = defaultDb,
): Promise<void> {
  const wanted = [...new Set(topicIds)];

  await database.delete(tutorTopics).where(eq(tutorTopics.tutorId, tutorId));
  if (wanted.length === 0) return;

  await database
    .insert(tutorTopics)
    .values(wanted.map((topicId) => ({ tutorId, topicId })))
    .onConflictDoNothing();
}

/**
 * How many of these chapters each tutor has declared.
 *
 * Read once for a whole page of results rather than per card, and used only to
 * break a tie inside a ranking tier that is already decided.
 */
export async function topicStrengthByTutor(
  tutorIds: readonly string[],
  topicIds: readonly string[],
  database: DbLike = defaultDb,
): Promise<Map<string, number>> {
  if (tutorIds.length === 0 || topicIds.length === 0) return new Map();

  const rows = await database
    .select({ tutorId: tutorTopics.tutorId, total: sql<number>`count(*)::int` })
    .from(tutorTopics)
    .where(
      and(
        inArray(tutorTopics.tutorId, [...tutorIds]),
        inArray(tutorTopics.topicId, [...topicIds]),
      ),
    )
    .groupBy(tutorTopics.tutorId);

  return new Map(rows.map((row) => [row.tutorId, Number(row.total)]));
}
