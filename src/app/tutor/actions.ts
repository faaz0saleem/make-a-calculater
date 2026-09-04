'use server';

/**
 * What a tutor does from their own home page: answer trial requests, reply to
 * a review.
 *
 * The booking id comes from the form; who is answering comes from the session.
 * `decideTrial` re-checks both the ownership and the twelve-hour window, so a
 * stale tab cannot accept something that expired while it was open.
 */

import { revalidatePath } from 'next/cache';

import { replyToReview } from '@/db/reviews';
import { decideTrial } from '@/db/trials';
import { requireRole } from '@/lib/auth/guards';

export async function answerTrial(formData: FormData): Promise<void> {
  const user = await requireRole('tutor');

  const bookingId = String(formData.get('bookingId') ?? '');
  const decision = String(formData.get('decision') ?? '') === 'accept' ? 'accept' : 'decline';

  if (bookingId) {
    await decideTrial(bookingId, user.id, decision);
  }

  revalidatePath('/tutor');
}

export async function postReviewReply(formData: FormData): Promise<void> {
  const user = await requireRole('tutor');

  const reviewId = String(formData.get('reviewId') ?? '');
  const reply = String(formData.get('reply') ?? '');

  if (reviewId && reply.trim()) {
    await replyToReview(reviewId, user.id, reply);
  }

  revalidatePath('/tutor');
  revalidatePath(`/tutors/${user.id}`);
}
