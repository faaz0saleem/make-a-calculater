/**
 * Follows, and the retention loop they exist for (SPEC.md §4).
 *
 * A student follows a tutor; when that tutor publishes new hours, every
 * follower gets a notification. That is the whole feature, and it is cheap:
 * one row per edge, one insert per follower when hours change.
 *
 * The dedupe key on notifications is what keeps it from being annoying — a
 * tutor who saves their calendar four times in a morning is one piece of news.
 */

import { and, count, desc, eq } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { emailFollowedTutorSlots } from './email-events';
import { notifyMany } from './notifications';
import { follows, tutorProfiles, users } from './schema';

export async function isFollowing(
  studentId: string,
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const [row] = await database
    .select({ tutorId: follows.tutorId })
    .from(follows)
    .where(and(eq(follows.studentId, studentId), eq(follows.tutorId, tutorId)))
    .limit(1);

  return Boolean(row);
}

/** Follow. Idempotent: pressing it twice is not an error. */
export async function followTutor(
  studentId: string,
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<void> {
  if (studentId === tutorId) return;

  await database
    .insert(follows)
    .values({ studentId, tutorId })
    .onConflictDoNothing({ target: [follows.studentId, follows.tutorId] });
}

export async function unfollowTutor(
  studentId: string,
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<void> {
  await database
    .delete(follows)
    .where(and(eq(follows.studentId, studentId), eq(follows.tutorId, tutorId)));
}

export async function followerCount(tutorId: string, database: DbLike = defaultDb): Promise<number> {
  const [row] = await database
    .select({ total: count() })
    .from(follows)
    .where(eq(follows.tutorId, tutorId));

  return row?.total ?? 0;
}

export type FollowedTutor = {
  tutorId: string;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  followedAt: Date;
};

export async function followedTutors(
  studentId: string,
  limit = 50,
  database: DbLike = defaultDb,
): Promise<FollowedTutor[]> {
  return database
    .select({
      tutorId: follows.tutorId,
      name: users.name,
      avatarUrl: users.image,
      headline: tutorProfiles.headline,
      followedAt: follows.createdAt,
    })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.tutorId))
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, follows.tutorId))
    .where(eq(follows.studentId, studentId))
    .orderBy(desc(follows.createdAt))
    .limit(limit);
}

/**
 * Tell a tutor's followers that there are new hours to book.
 *
 * `dayKey` keeps it to one notification per tutor per day per follower: the
 * news is "there is more time available", and hearing it four times in an hour
 * makes a student turn notifications off.
 */
export async function notifyFollowersOfNewAvailability(
  tutorId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<number> {
  const [tutor] = await database
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, tutorId))
    .limit(1);

  if (!tutor) return 0;

  const followers = await database
    .select({ studentId: follows.studentId })
    .from(follows)
    .where(eq(follows.tutorId, tutorId));

  if (followers.length === 0) return 0;

  const dayKey = now.toISOString().slice(0, 10);

  const told = await notifyMany(
    followers.map((follower) => ({
      userId: follower.studentId,
      kind: 'new_availability' as const,
      title: `${tutor.name} added new times`,
      body: 'They have opened up hours you can book.',
      href: `/tutors/${tutorId}`,
      dedupeKey: `availability:${tutorId}:${follower.studentId}:${dayKey}`,
    })),
    database,
  );

  // Keyed by the same day as the bell, so a tutor saving their calendar four
  // times before breakfast is one email as well as one notification.
  await emailFollowedTutorSlots(
    {
      followerIds: followers.map((follower) => follower.studentId),
      tutorId,
      tutorName: tutor.name ?? 'A tutor you follow',
      day: dayKey,
    },
    database,
  );

  return told;
}
