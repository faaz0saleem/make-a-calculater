'use server';

/**
 * What a student does from their dashboard: review a session they took.
 *
 * The booking id comes from the form and the student id from the session, so a
 * forged booking id gets `not_your_session` from the rules rather than somebody
 * else's review.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { upsertReview } from '@/db/reviews';
import { requireUser } from '@/lib/auth/guards';
import { reviewProblemMessage, type ReviewProblem } from '@/lib/reviews/rules';

export async function submitReview(formData: FormData): Promise<void> {
  const user = await requireUser();

  const bookingId = String(formData.get('bookingId') ?? '');
  const rating = Number(formData.get('rating') ?? 0);
  const body = String(formData.get('body') ?? '');
  const tutorId = String(formData.get('tutorId') ?? '');

  const result = await upsertReview({ bookingId, studentId: user.id, rating, body });

  if (!result.ok) {
    redirect(
      `/dashboard?reviewError=${encodeURIComponent(reviewProblemMessage(result.problem as ReviewProblem))}`,
    );
  }

  revalidatePath('/dashboard');
  if (tutorId) revalidatePath(`/tutors/${tutorId}`);
  redirect('/dashboard?reviewed=1');
}
