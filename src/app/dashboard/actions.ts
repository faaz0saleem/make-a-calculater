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

import { cancelBooking, decideReschedule, requestReschedule } from '@/db/bookings';
import { disputeProblemMessage, reportBookingProblem } from '@/db/disputes';
import { upsertReview } from '@/db/reviews';
import { requireUser } from '@/lib/auth/guards';
import { rescheduleProblemMessage } from '@/lib/bookings/reschedule';
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

/**
 * Cancelling, moving and reporting a session.
 *
 * All three resolve the actor from the session and let the data layer decide
 * whether they are allowed to touch that booking — a booking id in a form is
 * never trusted to mean it belongs to whoever posted it.
 */
export async function cancelBookingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const bookingId = String(formData.get('bookingId') ?? '');
  const back = String(formData.get('returnTo') ?? '/dashboard');

  const result = await cancelBooking({ bookingId, cancelledById: user.id });

  revalidatePath('/dashboard');
  revalidatePath('/tutor');

  if (!result.ok) {
    redirect(`${back}?error=${encodeURIComponent('That session could not be cancelled.')}`);
  }

  redirect(`${back}?cancelled=${result.refundCents}`);
}

export async function requestRescheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const bookingId = String(formData.get('bookingId') ?? '');
  const back = String(formData.get('returnTo') ?? '/dashboard');
  const newStartAtUtc = new Date(String(formData.get('newStartUtc') ?? ''));

  if (Number.isNaN(newStartAtUtc.getTime())) {
    redirect(`${back}?error=${encodeURIComponent('Pick a time to move it to.')}`);
  }

  const result = await requestReschedule({
    bookingId,
    requestedById: user.id,
    newStartAtUtc,
    note: String(formData.get('note') ?? '') || null,
  });

  revalidatePath('/dashboard');
  revalidatePath('/tutor');

  if (!result.ok) {
    const message =
      result.problem === 'slot_taken'
        ? 'That time is not free. Pick another.'
        : result.problem === 'not_yours' || result.problem === 'not_found'
          ? 'That session could not be found.'
          : rescheduleProblemMessage(result.problem);
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }

  redirect(`${back}?moved=1`);
}

export async function answerRescheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const requestId = String(formData.get('requestId') ?? '');
  const back = String(formData.get('returnTo') ?? '/dashboard');
  const accept = String(formData.get('decision') ?? '') === 'accept';

  const result = await decideReschedule({ requestId, deciderId: user.id, accept });

  revalidatePath('/dashboard');
  revalidatePath('/tutor');

  if (!result.ok) {
    const message =
      result.problem === 'expired'
        ? 'That request ran out of time. The session is unchanged.'
        : result.problem === 'slot_taken'
          ? 'That time was taken while the request was open. The session is unchanged.'
          : 'That request could not be answered.';
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }

  redirect(`${back}?${accept ? 'moved=1' : 'declined=1'}`);
}

export async function reportProblemAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const bookingId = String(formData.get('bookingId') ?? '');
  const back = String(formData.get('returnTo') ?? '/dashboard');

  const result = await reportBookingProblem({
    bookingId,
    reporterId: user.id,
    reason: String(formData.get('reason') ?? ''),
    body: String(formData.get('body') ?? '') || null,
  });

  revalidatePath('/dashboard');
  revalidatePath('/tutor');

  if (!result.ok) {
    redirect(`${back}?error=${encodeURIComponent(disputeProblemMessage(result.problem))}`);
  }

  redirect(`${back}?reported=1`);
}
