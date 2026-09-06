/**
 * Work between sessions (SPEC.md §9).
 *
 * The strongest anti-disintermediation feature in the product, and it is not a
 * restriction — it is value that only exists here. A tutor and a student who
 * move to WhatsApp keep the video call and lose this: the assignment tied to a
 * chapter, the file, the mark, the feedback, and the record of all four sitting
 * next to the progress view.
 *
 * Every function checks who is asking against the row, in the query, rather
 * than trusting the route to have done it.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { notify } from './notifications';
import { bookings, homework, topics, users } from './schema';
import type { Attachment } from './messages';

export const MAX_HOMEWORK_ATTACHMENTS = 5;

export type HomeworkRow = {
  id: string;
  bookingId: string;
  tutorId: string;
  studentId: string;
  topicId: string | null;
  topicName: string | null;
  title: string;
  body: string | null;
  attachments: Attachment[];
  dueAt: Date | null;
  status: string;
  submissionBody: string | null;
  submissionAttachments: Attachment[];
  submittedAt: Date | null;
  mark: number | null;
  markOutOf: number | null;
  feedback: string | null;
  markedAt: Date | null;
  createdAt: Date;
  otherName: string | null;
};

const VIEW = {
  id: homework.id,
  bookingId: homework.bookingId,
  tutorId: homework.tutorId,
  studentId: homework.studentId,
  topicId: homework.topicId,
  topicName: topics.name,
  title: homework.title,
  body: homework.body,
  attachments: homework.attachments,
  dueAt: homework.dueAt,
  status: homework.status,
  submissionBody: homework.submissionBody,
  submissionAttachments: homework.submissionAttachments,
  submittedAt: homework.submittedAt,
  mark: homework.mark,
  markOutOf: homework.markOutOf,
  feedback: homework.feedback,
  markedAt: homework.markedAt,
  createdAt: homework.createdAt,
} as const;

export type AssignResult = { ok: true; homeworkId: string } | { ok: false; reason: string };

/**
 * Set work off the back of a session.
 *
 * Tied to the booking rather than floating free, because "revise what we did on
 * Tuesday" is the assignment that gets done and "revise chapter four" is the
 * one that does not.
 */
export async function assignHomework(
  input: {
    bookingId: string;
    tutorId: string;
    title: string;
    body?: string | null;
    topicId?: string | null;
    dueAt?: Date | null;
    attachments?: Attachment[];
  },
  database: DbLike = defaultDb,
): Promise<AssignResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, reason: 'Give the work a title.' };

  const [booking] = await database
    .select({ studentId: bookings.studentId, tutorId: bookings.tutorId, completedAt: bookings.completedAt })
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);

  if (!booking || booking.tutorId !== input.tutorId) {
    return { ok: false, reason: 'That session could not be found.' };
  }

  const [created] = await database
    .insert(homework)
    .values({
      bookingId: input.bookingId,
      tutorId: input.tutorId,
      studentId: booking.studentId,
      topicId: input.topicId ?? null,
      title: title.slice(0, 200),
      body: input.body?.slice(0, 8_000) ?? null,
      dueAt: input.dueAt ?? null,
      attachments: (input.attachments ?? []).slice(0, MAX_HOMEWORK_ATTACHMENTS),
    })
    .returning({ id: homework.id });

  await notify(
    {
      userId: booking.studentId,
      kind: 'homework_assigned',
      title: 'New work from your tutor',
      body: title.slice(0, 200),
      href: '/homework',
      dedupeKey: `homework:${created!.id}:assigned`,
    },
    database,
  );

  return { ok: true, homeworkId: created!.id };
}

/** Hand it in. Resubmitting replaces what was there — a draft is not a version. */
export async function submitHomework(
  input: { homeworkId: string; studentId: string; body?: string | null; attachments?: Attachment[] },
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const body = input.body?.trim() ?? '';
  const attachments = (input.attachments ?? []).slice(0, MAX_HOMEWORK_ATTACHMENTS);

  if (!body && attachments.length === 0) {
    return { ok: false, reason: 'Write something or attach a file.' };
  }

  const [row] = await database
    .select({ id: homework.id, tutorId: homework.tutorId, title: homework.title, status: homework.status })
    .from(homework)
    .where(and(eq(homework.id, input.homeworkId), eq(homework.studentId, input.studentId)))
    .limit(1);

  if (!row) return { ok: false, reason: 'That work could not be found.' };
  if (row.status === 'cancelled') return { ok: false, reason: 'Your tutor withdrew this one.' };

  await database
    .update(homework)
    .set({
      submissionBody: body.slice(0, 20_000) || null,
      submissionAttachments: attachments,
      submittedAt: now,
      status: 'submitted',
      // A resubmission is unmarked again: the mark was for the old answer.
      mark: null,
      markOutOf: null,
      feedback: null,
      markedAt: null,
      updatedAt: now,
    })
    .where(eq(homework.id, input.homeworkId));

  await notify(
    {
      userId: row.tutorId,
      kind: 'homework_submitted',
      title: 'Work handed in',
      body: row.title,
      href: '/tutor/homework',
      dedupeKey: `homework:${row.id}:submitted:${now.toISOString().slice(0, 13)}`,
    },
    database,
  );

  return { ok: true };
}

/**
 * Mark it.
 *
 * The mark is optional and the feedback is not, because a number with nothing
 * beside it teaches nobody anything. `mark_out_of` is required whenever a mark
 * is given — the database enforces that too, so "7" can never be stored
 * without saying seven out of what.
 */
export async function markHomework(
  input: {
    homeworkId: string;
    tutorId: string;
    mark?: number | null;
    markOutOf?: number | null;
    feedback: string;
  },
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const feedback = input.feedback.trim();
  if (!feedback) return { ok: false, reason: 'Say something about it. A bare mark teaches nothing.' };

  const hasMark = typeof input.mark === 'number';
  if (hasMark && typeof input.markOutOf !== 'number') {
    return { ok: false, reason: 'A mark needs to be out of something.' };
  }
  if (hasMark && (input.mark! < 0 || input.mark! > input.markOutOf!)) {
    return { ok: false, reason: 'That mark is outside the range you gave.' };
  }

  const [row] = await database
    .select({ id: homework.id, studentId: homework.studentId, title: homework.title, submittedAt: homework.submittedAt })
    .from(homework)
    .where(and(eq(homework.id, input.homeworkId), eq(homework.tutorId, input.tutorId)))
    .limit(1);

  if (!row) return { ok: false, reason: 'That work could not be found.' };
  if (!row.submittedAt) return { ok: false, reason: 'Nothing has been handed in yet.' };

  await database
    .update(homework)
    .set({
      mark: hasMark ? input.mark! : null,
      markOutOf: hasMark ? input.markOutOf! : null,
      feedback: feedback.slice(0, 8_000),
      markedAt: now,
      status: 'marked',
      updatedAt: now,
    })
    .where(eq(homework.id, input.homeworkId));

  await notify(
    {
      userId: row.studentId,
      kind: 'homework_marked',
      title: 'Your work has been marked',
      body: row.title,
      href: '/homework',
      dedupeKey: `homework:${row.id}:marked:${now.toISOString().slice(0, 13)}`,
    },
    database,
  );

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function listFor(
  column: typeof homework.studentId | typeof homework.tutorId,
  userId: string,
  otherColumn: typeof homework.tutorId | typeof homework.studentId,
  database: DbLike,
  limit: number,
): Promise<HomeworkRow[]> {
  const rows = await database
    .select({ ...VIEW, otherName: users.name })
    .from(homework)
    .leftJoin(topics, eq(topics.id, homework.topicId))
    .innerJoin(users, eq(users.id, otherColumn))
    .where(eq(column, userId))
    .orderBy(
      // Anything still waiting on somebody comes first, then newest.
      sql`case when ${homework.status} = 'assigned' then 0
               when ${homework.status} = 'submitted' then 1 else 2 end`,
      desc(homework.createdAt),
    )
    .limit(limit);

  return rows as unknown as HomeworkRow[];
}

export function homeworkForStudent(
  studentId: string,
  database: DbLike = defaultDb,
  limit = 50,
): Promise<HomeworkRow[]> {
  return listFor(homework.studentId, studentId, homework.tutorId, database, limit);
}

export function homeworkForTutor(
  tutorId: string,
  database: DbLike = defaultDb,
  limit = 50,
): Promise<HomeworkRow[]> {
  return listFor(homework.tutorId, tutorId, homework.studentId, database, limit);
}

/** Work set off one session, for the after-session page. */
export async function homeworkForBooking(
  bookingId: string,
  database: DbLike = defaultDb,
): Promise<HomeworkRow[]> {
  const rows = await database
    .select({ ...VIEW, otherName: sql<string | null>`null` })
    .from(homework)
    .leftJoin(topics, eq(topics.id, homework.topicId))
    .where(eq(homework.bookingId, bookingId))
    .orderBy(asc(homework.createdAt));

  return rows as unknown as HomeworkRow[];
}

/** One piece of work, for somebody who is on it. */
export async function homeworkForViewer(
  homeworkId: string,
  viewerId: string,
  database: DbLike = defaultDb,
): Promise<HomeworkRow | null> {
  const [row] = await database
    .select({ ...VIEW, otherName: sql<string | null>`null` })
    .from(homework)
    .leftJoin(topics, eq(topics.id, homework.topicId))
    .where(
      and(
        eq(homework.id, homeworkId),
        sql`(${homework.studentId} = ${viewerId}::uuid or ${homework.tutorId} = ${viewerId}::uuid)`,
      ),
    )
    .limit(1);

  return (row as unknown as HomeworkRow | undefined) ?? null;
}
