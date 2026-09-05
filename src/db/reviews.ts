/**
 * Reviews (SPEC.md §9).
 *
 * Who may write one is decided by `src/lib/reviews/rules.ts`; this file reads
 * rows, applies that answer, and writes. The displayed rating is the Bayesian
 * average — the same function the ranking score uses, so the number on the
 * profile and the ordering of the feed can never disagree.
 *
 * A hidden review disappears from every public read *and* from the rating it
 * contributed to, which is the point of hiding it.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { notify } from './notifications';
import { bookings, reviews, users } from './schema';
import { writeAudit } from '@/lib/admin/audit';
import {
  EMPTY_DISTRIBUTION,
  MAX_REPLY_CHARS,
  MAX_REVIEW_CHARS,
  canEditReview,
  canWriteReview,
  isValidRating,
  summariseRatings,
  type RatingDistribution,
  type RatingSummary,
  type ReviewProblem,
} from '@/lib/reviews/rules';

export type ReviewRow = {
  id: string;
  bookingId: string;
  studentId: string;
  studentName: string;
  studentAvatarUrl: string | null;
  rating: number;
  body: string | null;
  tutorReply: string | null;
  tutorRepliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReviewResult = { ok: true; reviewId: string } | { ok: false; problem: ReviewProblem };

/**
 * Write or update a review.
 *
 * One per booking, enforced by `reviews_booking_key`; the check below is for
 * the message, the index is for the race.
 */
export async function upsertReview(
  input: { bookingId: string; studentId: string; rating: number; body: string | null },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<ReviewResult> {
  if (!isValidRating(input.rating)) return { ok: false, problem: 'bad_rating' };

  const [booking] = await database
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      completedAt: bookings.completedAt,
    })
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);

  if (!booking) return { ok: false, problem: 'not_your_session' };

  const [existing] = await database
    .select({ id: reviews.id, studentId: reviews.studentId, createdAt: reviews.createdAt })
    .from(reviews)
    .where(eq(reviews.bookingId, input.bookingId))
    .limit(1);

  const body = input.body?.trim() ? input.body.trim().slice(0, MAX_REVIEW_CHARS) : null;

  if (existing) {
    const problem = canEditReview(existing, input.studentId, now);
    if (problem) return { ok: false, problem };

    await database
      .update(reviews)
      .set({ rating: input.rating, body, updatedAt: now })
      .where(eq(reviews.id, existing.id));

    return { ok: true, reviewId: existing.id };
  }

  const problem = canWriteReview(booking, input.studentId, false);
  if (problem) return { ok: false, problem };

  const [created] = await database
    .insert(reviews)
    .values({
      bookingId: booking.id,
      studentId: booking.studentId,
      tutorId: booking.tutorId,
      rating: input.rating,
      body,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: reviews.id });

  await notify(
    {
      userId: booking.tutorId,
      kind: 'new_review',
      title: `New ${input.rating}-star review`,
      body: body ? body.slice(0, 120) : 'No comment left.',
      href: '/tutor',
      dedupeKey: `review:${created!.id}:new`,
    },
    database,
  );

  return { ok: true, reviewId: created!.id };
}

export type ReplyResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_yours' | 'already_replied' };

/** One public reply per review (SPEC.md §9). */
export async function replyToReview(
  reviewId: string,
  tutorId: string,
  reply: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<ReplyResult> {
  const [review] = await database
    .select({ id: reviews.id, tutorId: reviews.tutorId, studentId: reviews.studentId, tutorReply: reviews.tutorReply })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);

  if (!review) return { ok: false, reason: 'not_found' };
  if (review.tutorId !== tutorId) return { ok: false, reason: 'not_yours' };
  if (review.tutorReply) return { ok: false, reason: 'already_replied' };

  const text = reply.trim().slice(0, MAX_REPLY_CHARS);
  if (!text) return { ok: false, reason: 'not_found' };

  await database
    .update(reviews)
    .set({ tutorReply: text, tutorRepliedAt: now, updatedAt: now })
    .where(eq(reviews.id, reviewId));

  await notify(
    {
      userId: review.studentId,
      kind: 'review_reply',
      title: 'Your tutor replied to your review',
      body: text.slice(0, 120),
      href: '/dashboard',
      dedupeKey: `review:${reviewId}:reply`,
    },
    database,
  );

  return { ok: true };
}

/**
 * Hide a review for a policy violation (SPEC.md §9, §10).
 *
 * Writes an `admin_audit` row with the reason. Hidden reviews leave the public
 * reads and the rating; the row stays so the decision can be reviewed.
 */
export async function hideReview(
  reviewId: string,
  admin: { id: string; ip?: string | null },
  reason: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<{ ok: boolean }> {
  const [review] = await database
    .select({ id: reviews.id, tutorId: reviews.tutorId, rating: reviews.rating, hiddenAt: reviews.hiddenAt })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);

  if (!review || review.hiddenAt) return { ok: false };
  if (!reason.trim()) return { ok: false };

  await database
    .update(reviews)
    .set({ hiddenAt: now, hiddenReason: reason.trim(), updatedAt: now })
    .where(eq(reviews.id, reviewId));

  await writeAudit(database, {
    actorId: admin.id,
    action: 'review.hide',
    targetType: 'review',
    targetId: reviewId,
    before: { hidden: false, rating: review.rating },
    after: { hidden: true, rating: review.rating },
    reason: reason.trim(),
    ip: admin.ip ?? null,
  });

  return { ok: true };
}

/** Undo a hide, also audited. */
export async function unhideReview(
  reviewId: string,
  admin: { id: string; ip?: string | null },
  reason: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<{ ok: boolean }> {
  const [review] = await database
    .select({ id: reviews.id, hiddenAt: reviews.hiddenAt, rating: reviews.rating })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);

  if (!review || !review.hiddenAt) return { ok: false };

  await database
    .update(reviews)
    .set({ hiddenAt: null, hiddenReason: null, updatedAt: now })
    .where(eq(reviews.id, reviewId));

  await writeAudit(database, {
    actorId: admin.id,
    action: 'review.unhide',
    targetType: 'review',
    targetId: reviewId,
    before: { hidden: true, rating: review.rating },
    after: { hidden: false, rating: review.rating },
    reason: reason.trim() || 'restored',
    ip: admin.ip ?? null,
  });

  return { ok: true };
}

/** The visible reviews for a tutor, newest first. */
export async function reviewsForTutor(
  tutorId: string,
  limit = 20,
  database: DbLike = defaultDb,
): Promise<ReviewRow[]> {
  return database
    .select({
      id: reviews.id,
      bookingId: reviews.bookingId,
      studentId: reviews.studentId,
      studentName: users.name,
      studentAvatarUrl: users.image,
      rating: reviews.rating,
      body: reviews.body,
      tutorReply: reviews.tutorReply,
      tutorRepliedAt: reviews.tutorRepliedAt,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.studentId))
    .where(and(eq(reviews.tutorId, tutorId), isNull(reviews.hiddenAt)))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

/** The star breakdown behind the number on the profile. */
export async function ratingSummaryFor(
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<RatingSummary> {
  const rows = await database
    .select({ rating: reviews.rating, total: sql<number>`count(*)::int` })
    .from(reviews)
    .where(and(eq(reviews.tutorId, tutorId), isNull(reviews.hiddenAt)))
    .groupBy(reviews.rating);

  const distribution: RatingDistribution = { ...EMPTY_DISTRIBUTION };
  for (const row of rows) {
    if (row.rating >= 1 && row.rating <= 5) {
      distribution[row.rating as 1 | 2 | 3 | 4 | 5] = row.total;
    }
  }

  return summariseRatings(distribution);
}

export type ReviewableSession = {
  bookingId: string;
  tutorId: string;
  tutorName: string;
  startAtUtc: Date;
  completedAt: Date;
  priceCents: number;
  existing: { id: string; rating: number; body: string | null; createdAt: Date } | null;
};

/**
 * Sessions this student can review, and what they already said.
 *
 * Drives the review prompt on the dashboard: a completed paid session with no
 * review yet, or one still inside its edit window.
 */
export async function reviewableSessionsFor(
  studentId: string,
  limit = 10,
  database: DbLike = defaultDb,
): Promise<ReviewableSession[]> {
  const rows = await database
    .select({
      bookingId: bookings.id,
      tutorId: bookings.tutorId,
      tutorName: users.name,
      startAtUtc: bookings.startAtUtc,
      completedAt: bookings.completedAt,
      priceCents: bookings.priceCents,
      reviewId: reviews.id,
      rating: reviews.rating,
      body: reviews.body,
      reviewedAt: reviews.createdAt,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.tutorId))
    .leftJoin(reviews, eq(reviews.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.studentId, studentId),
        eq(bookings.isTrial, false),
        sql`${bookings.completedAt} is not null`,
        sql`${bookings.priceCents} > 0`,
      ),
    )
    .orderBy(desc(bookings.startAtUtc))
    .limit(limit);

  return rows.map((row) => ({
    bookingId: row.bookingId,
    tutorId: row.tutorId,
    tutorName: row.tutorName,
    startAtUtc: row.startAtUtc,
    completedAt: row.completedAt!,
    priceCents: row.priceCents,
    existing:
      row.reviewId && row.rating !== null && row.reviewedAt
        ? { id: row.reviewId, rating: row.rating, body: row.body, createdAt: row.reviewedAt }
        : null,
  }));
}
