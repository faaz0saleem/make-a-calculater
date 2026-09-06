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

import { acceptPendingBooking, cancelBooking } from '@/db/bookings';
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


/**
 * Accept or turn down a paid booking that is waiting on you.
 *
 * Only reachable for a tutor who has lost instant booking (SPEC.md §2, §7).
 * The student's credits are already in escrow, so accepting promises the hour
 * and declining gives every credit back — the same path an ordinary
 * cancellation takes, at the tutor's door.
 */
export async function answerBooking(formData: FormData): Promise<void> {
  const user = await requireRole('tutor');

  const bookingId = String(formData.get('bookingId') ?? '');
  const accept = String(formData.get('decision') ?? '') === 'accept';

  if (bookingId) {
    if (accept) {
      await acceptPendingBooking(bookingId, user.id);
    } else {
      await cancelBooking({ bookingId, cancelledById: user.id });
    }
  }

  revalidatePath('/tutor');
  revalidatePath('/dashboard');
}
