'use server';

/**
 * Actions on a tutor's profile: ask for a free trial, follow, unfollow.
 *
 * Every one of them resolves who is asking from the session. Nothing trusts a
 * student id from the form — the only thing a form carries here is which slot
 * was pressed.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createBooking, holdSlot, releaseHold } from '@/db/bookings';
import { followTutor, unfollowTutor } from '@/db/follows';
import { requestTrial } from '@/db/trials';
import { requireUser } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { trialProblemMessage, type TrialRequestProblem } from '@/lib/trials/rules';

const FAILURE_MESSAGES: Record<string, string> = {
  slot_taken: 'Someone just took that slot. Pick another one.',
  not_available: 'That time is no longer free. The calendar below is up to date.',
  no_such_tutor: 'That tutor could not be found.',
};

function describe(problem: string): string {
  return (
    FAILURE_MESSAGES[problem] ??
    trialProblemMessage(problem as TrialRequestProblem) ??
    'That trial could not be requested.'
  );
}

export async function askForTrial(tutorId: string, formData: FormData): Promise<void> {
  const user = await requireUser();

  const startAtUtc = new Date(String(formData.get('startUtc') ?? ''));
  if (Number.isNaN(startAtUtc.getTime())) {
    redirect(`/tutors/${tutorId}?mode=trial&error=${encodeURIComponent('That slot could not be read.')}`);
  }

  const result = await requestTrial({ studentId: user.id, tutorId, startAtUtc });

  if (!result.ok) {
    redirect(`/tutors/${tutorId}?mode=trial&error=${encodeURIComponent(describe(result.problem))}`);
  }

  revalidatePath(`/tutors/${tutorId}`);
  revalidatePath('/dashboard');
  redirect('/dashboard?requested=trial');
}

export async function toggleFollow(tutorId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const following = String(formData.get('following') ?? '') === 'true';

  if (following) {
    await unfollowTutor(user.id, tutorId);
  } else {
    await followTutor(user.id, tutorId);
  }

  revalidatePath(`/tutors/${tutorId}`);
}

const BOOKING_MESSAGES: Record<string, string> = {
  no_such_tutor: 'That tutor could not be found.',
  not_bookable: 'This tutor is not taking bookings at the moment.',
  own_profile: 'You cannot book yourself.',
  slot_taken: 'Somebody just took that time. Pick another one — nothing has been charged.',
  not_available: 'That time is no longer free. The calendar below is up to date.',
  bad_duration: 'Sessions are 30 or 60 minutes.',
};

/**
 * Book a paid session.
 *
 * When the balance is short, the slot is held for ten minutes and the student
 * is sent to buy credits — so they do not come back to find it gone. The hold
 * is not a booking: it stops other people starting, and the partial unique
 * index is still what decides who gets the slot.
 */
export async function bookSession(
  tutorId: string,
  durationMinutes: 30 | 60,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();

  const startAtUtc = new Date(String(formData.get('startUtc') ?? ''));
  if (Number.isNaN(startAtUtc.getTime())) {
    redirect(`/tutors/${tutorId}?mode=${durationMinutes}&error=${encodeURIComponent('That slot could not be read.')}`);
  }

  const result = await createBooking({
    studentId: user.id,
    tutorId,
    startAtUtc,
    durationMinutes,
  });

  if (result.ok) {
    revalidatePath(`/tutors/${tutorId}`);
    revalidatePath('/dashboard');
    redirect(`/dashboard?booked=${result.bookingId}`);
  }

  if (result.problem === 'insufficient_credits') {
    // Hold the slot first, then send them to top up. Doing it the other way
    // round means buying credits and losing the time you bought them for.
    await holdSlot({ studentId: user.id, tutorId, startAtUtc, durationMinutes });

    const back = `/tutors/${tutorId}?mode=${durationMinutes}&at=${encodeURIComponent(startAtUtc.toISOString())}`;
    const short = formatCents(result.shortfallCents ?? 0);
    redirect(
      `/credits?returnTo=${encodeURIComponent(back)}&error=${encodeURIComponent(
        `You need ${short} more in credits for that session. Your slot is held for 10 minutes.`,
      )}`,
    );
  }

  redirect(
    `/tutors/${tutorId}?mode=${durationMinutes}&error=${encodeURIComponent(
      BOOKING_MESSAGES[result.problem] ?? 'That session could not be booked.',
    )}`,
  );
}

/** Give up a held slot deliberately, rather than waiting the ten minutes out. */
export async function dropHold(tutorId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const startAtUtc = new Date(String(formData.get('startUtc') ?? ''));

  if (!Number.isNaN(startAtUtc.getTime())) {
    await releaseHold({ studentId: user.id, tutorId, startAtUtc });
  }

  revalidatePath(`/tutors/${tutorId}`);
}
