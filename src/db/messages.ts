/**
 * Messaging (SPEC.md §8).
 *
 * Two rules shape this file.
 *
 * **No cold DMs.** A thread exists only once there is a booking or a trial
 * request between the two people. `ensureThread` in `./trials.ts` is called
 * from those paths; nothing here creates a thread out of nothing.
 *
 * **The raw body never leaves.** Bodies are masked on write, and the readable
 * projection below is the only one this module exports. `body_raw` is selected
 * in exactly one place in the codebase — `src/db/moderation.ts`, which requires
 * an admin — so a route cannot leak it by accident, and `e2e/messaging.spec.ts`
 * proves a tutor cannot reach it.
 */

import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { notify } from './notifications';
import { recordContactFlag } from './reports';
import { messages, threads, tutorProfiles, users } from './schema';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_CHARS,
} from '@/lib/messaging/limits';
import { scoreContactIntent, shouldQueueForReview } from '@/lib/messaging/contact-intent';
import { maskContactInfo } from '@/lib/messaging/masking';
import { responseMedianFor } from '@/lib/messaging/response-time';

export {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_CHARS,
} from '@/lib/messaging/limits';

export type Attachment = { url: string; name: string; bytes: number };

/**
 * What a participant is allowed to see. `bodyRaw` is deliberately absent — this
 * shape is the projection every read in the app goes through.
 */
export type ThreadMessageRow = {
  id: string;
  senderId: string;
  body: string;
  redactions: number;
  attachments: Attachment[];
  readAt: Date | null;
  createdAt: Date;
};

export type ThreadSummary = {
  id: string;
  studentId: string;
  tutorId: string;
  otherId: string;
  otherName: string;
  otherAvatarUrl: string | null;
  lastMessageAt: Date | null;
  lastMessage: string | null;
  unread: number;
};

export type ThreadView = {
  id: string;
  studentId: string;
  tutorId: string;
  otherId: string;
  otherName: string;
  otherAvatarUrl: string | null;
  viewerIsTutor: boolean;
  messages: ThreadMessageRow[];
};

/** The thread for a pair, if there is one. Never creates. */
export async function findThread(
  studentId: string,
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<{ id: string } | null> {
  const [row] = await database
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.studentId, studentId), eq(threads.tutorId, tutorId)))
    .limit(1);

  return row ?? null;
}

/**
 * One thread, for one of its two participants.
 *
 * Anyone else gets null, which the route turns into a 404 rather than a 403:
 * a 403 would confirm the thread exists.
 */
export async function loadThreadForViewer(
  threadId: string,
  viewerId: string,
  database: DbLike = defaultDb,
): Promise<ThreadView | null> {
  const [thread] = await database
    .select({ id: threads.id, studentId: threads.studentId, tutorId: threads.tutorId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);

  if (!thread) return null;
  if (thread.studentId !== viewerId && thread.tutorId !== viewerId) return null;

  const viewerIsTutor = thread.tutorId === viewerId;
  const otherId = viewerIsTutor ? thread.studentId : thread.tutorId;

  const [other] = await database
    .select({ name: users.name, image: users.image })
    .from(users)
    .where(eq(users.id, otherId))
    .limit(1);

  const rows = await database
    .select({
      id: messages.id,
      senderId: messages.senderId,
      body: messages.bodyMasked,
      redactions: messages.redactions,
      attachments: messages.attachments,
      readAt: messages.readAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt));

  return {
    id: thread.id,
    studentId: thread.studentId,
    tutorId: thread.tutorId,
    otherId,
    otherName: other?.name ?? 'Someone',
    otherAvatarUrl: other?.image ?? null,
    viewerIsTutor,
    messages: rows.map((row) => ({ ...row, attachments: row.attachments ?? [] })),
  };
}

/** Every thread this person is in, newest activity first. */
export async function listThreadsFor(
  userId: string,
  database: DbLike = defaultDb,
): Promise<ThreadSummary[]> {
  const rows = await database
    .select({
      id: threads.id,
      studentId: threads.studentId,
      tutorId: threads.tutorId,
      lastMessageAt: threads.lastMessageAt,
      studentName: sql<string>`student.name`,
      // `users.image` is the Auth.js name for the `avatar_url` column, and a
      // raw fragment has to say what Postgres calls it.
      studentImage: sql<string | null>`student.avatar_url`,
      tutorName: sql<string>`tutor.name`,
      tutorImage: sql<string | null>`tutor.avatar_url`,
      lastMessage: sql<string | null>`(
        select m.body_masked from messages m
        where m.thread_id = ${threads.id}
        order by m.created_at desc limit 1
      )`,
      unread: sql<number>`(
        select count(*)::int from messages m
        where m.thread_id = ${threads.id} and m.sender_id <> ${userId} and m.read_at is null
      )`,
    })
    .from(threads)
    .innerJoin(sql`users as student`, sql`student.id = ${threads.studentId}`)
    .innerJoin(sql`users as tutor`, sql`tutor.id = ${threads.tutorId}`)
    .where(sql`${threads.studentId} = ${userId} or ${threads.tutorId} = ${userId}`)
    .orderBy(desc(sql`coalesce(${threads.lastMessageAt}, ${threads.createdAt})`));

  return rows.map((row) => {
    const viewerIsTutor = row.tutorId === userId;
    return {
      id: row.id,
      studentId: row.studentId,
      tutorId: row.tutorId,
      otherId: viewerIsTutor ? row.studentId : row.tutorId,
      otherName: viewerIsTutor ? row.studentName : row.tutorName,
      otherAvatarUrl: (viewerIsTutor ? row.studentImage : row.tutorImage) ?? null,
      lastMessageAt: row.lastMessageAt,
      lastMessage: row.lastMessage,
      unread: row.unread,
    };
  });
}

export type SendResult =
  | { ok: true; messageId: string; redactions: number }
  | { ok: false; reason: 'not_in_thread' | 'empty' | 'too_long' | 'too_many_attachments' | 'attachment_too_big' };

/**
 * Post a message.
 *
 * The body is masked here, on write, before it is stored — not on read, and not
 * in the browser. Both copies are written in one statement so there is never a
 * moment where the raw text exists as the readable one.
 */
export async function sendMessage(
  input: { threadId: string; senderId: string; body: string; attachments?: Attachment[] },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<SendResult> {
  const body = input.body.trim();
  const attachments = input.attachments ?? [];

  if (!body && attachments.length === 0) return { ok: false, reason: 'empty' };
  if (body.length > MAX_MESSAGE_CHARS) return { ok: false, reason: 'too_long' };
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) return { ok: false, reason: 'too_many_attachments' };
  if (attachments.some((file) => file.bytes > MAX_ATTACHMENT_BYTES)) {
    return { ok: false, reason: 'attachment_too_big' };
  }

  const [thread] = await database
    .select({ id: threads.id, studentId: threads.studentId, tutorId: threads.tutorId })
    .from(threads)
    .where(eq(threads.id, input.threadId))
    .limit(1);

  if (!thread) return { ok: false, reason: 'not_in_thread' };
  if (thread.studentId !== input.senderId && thread.tutorId !== input.senderId) {
    return { ok: false, reason: 'not_in_thread' };
  }

  const masked = maskContactInfo(body);
  const intent = scoreContactIntent(body);
  const recipientId = thread.studentId === input.senderId ? thread.tutorId : thread.studentId;

  const [created] = await database
    .insert(messages)
    .values({
      threadId: thread.id,
      senderId: input.senderId,
      bodyMasked: masked.masked,
      bodyRaw: body,
      redactions: masked.redactions,
      attachments,
      createdAt: now,
    })
    .returning({ id: messages.id });

  await database.update(threads).set({ lastMessageAt: now }).where(eq(threads.id, thread.id));

  /**
   * A high-confidence contact-info attempt goes in front of a person.
   *
   * Note where this sits: *after* the message is written, and outside anything
   * that could undo it. The message is sent either way. A tutor mid-lesson is
   * never interrupted by this, and a failure to write the flag loses a
   * moderation row rather than a lesson — which is the right way round.
   */
  if (shouldQueueForReview(intent)) {
    try {
      await recordContactFlag(
        { messageId: created!.id, threadId: thread.id, senderId: input.senderId, intent },
        database,
      );
    } catch (error) {
      console.error('could not record a contact flag; the message was still sent', error);
    }
  }

  await notify(
    {
      userId: recipientId,
      kind: 'new_message',
      title: 'New message',
      body: masked.masked.slice(0, 120) || 'Sent you an attachment',
      href: `/messages/${thread.id}`,
      // One unread nudge per thread until they have looked at it.
      dedupeKey: `thread:${thread.id}:unread:${recipientId}`,
    },
    database,
  );

  // The badge students look for is "Responds in <1h", so the median is kept
  // fresh as the tutor replies rather than only overnight.
  if (thread.tutorId === input.senderId) {
    await recomputeResponseMedian(thread.tutorId, now, database);
  }

  return { ok: true, messageId: created!.id, redactions: masked.redactions };
}

/** Mark the other side's messages read, and clear the bell nudge. */
export async function markThreadRead(
  threadId: string,
  viewerId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<void> {
  await database
    .update(messages)
    .set({ readAt: now })
    .where(and(eq(messages.threadId, threadId), ne(messages.senderId, viewerId), isNull(messages.readAt)));

  await database.execute(sql`
    delete from notifications
    where user_id = ${viewerId} and dedupe_key = ${`thread:${threadId}:unread:${viewerId}`}
  `);
}

/**
 * Recompute one tutor's median reply time (SPEC.md §4, §8).
 *
 * Reads only sender and timestamp — never a body. Writes the median onto
 * `tutor_profiles`, which is what the card badge and the nightly ranking job
 * both read; neither computes anything in the request path.
 */
export async function recomputeResponseMedian(
  tutorId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<number | null> {
  const rows = await database
    .select({
      threadId: messages.threadId,
      senderId: messages.senderId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(eq(threads.tutorId, tutorId))
    .orderBy(asc(messages.createdAt));

  const byThread = new Map<string, { senderId: string; createdAt: Date }[]>();
  for (const row of rows) {
    const thread = byThread.get(row.threadId) ?? [];
    thread.push({ senderId: row.senderId, createdAt: row.createdAt });
    byThread.set(row.threadId, thread);
  }

  // Through `responseMedianFor`, so the minimum-sample rule applies here too:
  // one reply is an anecdote and the profile renders it as "Usually replies
  // within an hour".
  const median = responseMedianFor([...byThread.values()], tutorId, now);

  await database
    .update(tutorProfiles)
    .set({ responseMedianSeconds: median, updatedAt: now })
    .where(eq(tutorProfiles.userId, tutorId));

  return median;
}

/** Refresh every tutor's median. Called by the nightly ranking job. */
export async function recomputeAllResponseMedians(
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<number> {
  const tutors = await database.select({ id: tutorProfiles.userId }).from(tutorProfiles);
  for (const tutor of tutors) {
    await recomputeResponseMedian(tutor.id, now, database);
  }
  return tutors.length;
}
