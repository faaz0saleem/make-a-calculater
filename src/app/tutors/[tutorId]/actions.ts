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

import { createBooking, holdSlot, releaseHold, setBookingNote } from '@/db/bookings';
import { followTutor, unfollowTutor } from '@/db/follows';
import { confirmStudentName, linkGuardian } from '@/db/students';
import { setBookingTopics } from '@/db/topics';
import { requestTrial } from '@/db/trials';
import { currentUser, requireUser } from '@/lib/auth/guards';
import { ensureGuestToken, readGuestToken } from '@/lib/bookings/guest';
import { formatCents } from '@/lib/money/cents';
import { trialProblemMessage, type TrialRequestProblem } from '@/lib/trials/rules';

const FAILURE_MESSAGES: Record<string, string> = {
  slot_taken: 'Someone just took that slot. Pick another one.',
  not_available: 'That time is no longer free. The calendar below is up to date.',
  no_such_tutor: 'That tutor could not be found.',
  // A trial is free and it is still a lesson. The guardian's email is asked for
  // on the booking page today, which is where this sends them — see BUGS.md for
  // why the trial journey does not ask for it itself yet.
  guardian_required:
    'We need a parent or guardian’s email before your first lesson, including a free trial. Open any paid slot to add it — nothing is charged until you confirm.',
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
  guardian_required:
    'We need a parent or guardian’s email before your first session. Nothing has been charged.',
  already_booked: 'You have already booked this session. It is on your dashboard.',
};

/**
 * Back to the calendar, saying why.
 *
 * The only way to lose a slot at this step is somebody else holding it, and
 * nothing has been charged yet — picking a slot does not touch money.
 */
function slotGone(tutorId: string, durationMinutes: 30 | 60): string {
  const message = 'Somebody else is booking that time right now. Pick another one — nothing has been charged.';
  return `/tutors/${tutorId}?mode=${durationMinutes}&error=${encodeURIComponent(message)}`;
}

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
  const startAtUtc = new Date(String(formData.get('startUtc') ?? ''));
  if (Number.isNaN(startAtUtc.getTime())) {
    redirect(`/tutors/${tutorId}?mode=${durationMinutes}&error=${encodeURIComponent('That slot could not be read.')}`);
  }

  const bookHere = `/tutors/${tutorId}/book?mode=${durationMinutes}&at=${encodeURIComponent(startAtUtc.toISOString())}`;
  const user = await currentUser();

  // Signed out: hold the slot, then send them to sign up. Holding *first* is
  // the whole point — "create an account to book this" has to mean the slot is
  // still there when they come back, not that they can look for it again.
  //
  // Which is exactly why the result is checked. `holdSlot` refuses when
  // somebody else is already holding this time, and walking on regardless
  // would send them to sign up, and then to buy credits, for a slot they
  // cannot have — telling them it was held for them the whole way. Better to
  // say so here, while the only thing they have spent is a click.
  if (!user) {
    const guestToken = await ensureGuestToken();
    const held = await holdSlot({ guestToken, tutorId, startAtUtc, durationMinutes });
    if (!held.ok) redirect(slotGone(tutorId, durationMinutes));
    redirect(`/signup?next=${encodeURIComponent(bookHere)}&held=1`);
  }

  // Signed in: hold it and take them to the one page that shows the price, the
  // balance and the top-up together. Committing happens there.
  const held = await holdSlot({ studentId: user.id, tutorId, startAtUtc, durationMinutes });
  if (!held.ok) redirect(slotGone(tutorId, durationMinutes));
  redirect(bookHere);
}

/**
 * Commit: the booking itself.
 *
 * Split from picking a slot because that is where the paywall now sits. By the
 * time somebody presses this they have seen the tutor, the time, the price and
 * their balance — which is the moment to ask for money, and not before.
 */
export async function confirmBooking(
  tutorId: string,
  durationMinutes: 30 | 60,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();

  const startAtUtc = new Date(String(formData.get('startUtc') ?? ''));
  if (Number.isNaN(startAtUtc.getTime())) {
    redirect(`/tutors/${tutorId}?error=${encodeURIComponent('That slot could not be read.')}`);
  }

  const name = String(formData.get('name') ?? '').trim();
  if (name) await confirmStudentName(user.id, name);

  const guardianEmail = String(formData.get('guardianEmail') ?? '').trim();
  if (guardianEmail) await linkGuardian(user.id, guardianEmail);

  const result = await createBooking({ studentId: user.id, tutorId, startAtUtc, durationMinutes });

  if (result.ok) {
    // What the session is for. Attached after the booking exists rather than
    // inside it, because a chapter list is not worth failing a booking over —
    // a session with no topics is a session, and the tutor can ask.
    const topicIds = formData.getAll('topicIds').map(String).filter(Boolean);
    const topicNote = String(formData.get('topicNote') ?? '').trim();

    if (topicIds.length > 0) await setBookingTopics(result.bookingId, topicIds);
    if (topicNote) await setBookingNote(result.bookingId, user.id, topicNote);

    revalidatePath(`/tutors/${tutorId}`);
    revalidatePath('/dashboard');
    redirect(`/dashboard?booked=${result.bookingId}`);
  }

  // They already have this session: the form was submitted twice and the first
  // one worked. Send them where the first submit would have sent them, rather
  // than telling them the time is no longer free — which is true of the
  // calendar and false about their booking and their credits.
  if (result.problem === 'already_booked' && result.bookingId) {
    revalidatePath('/dashboard');
    redirect(`/dashboard?booked=${result.bookingId}`);
  }

  const back = `/tutors/${tutorId}/book?mode=${durationMinutes}&at=${encodeURIComponent(startAtUtc.toISOString())}`;

  if (result.problem === 'insufficient_credits') {
    // Not a redirect to a separate credits page any more: the top-up is on the
    // booking page itself, so this just comes back with the shortfall named.
    redirect(`${back}&short=${result.shortfallCents ?? 0}`);
  }

  redirect(
    `${back}&error=${encodeURIComponent(
      BOOKING_MESSAGES[result.problem] ?? 'That session could not be booked.',
    )}`,
  );
}

/** Give up a held slot deliberately, rather than waiting the ten minutes out. */
export async function dropHold(tutorId: string, formData: FormData): Promise<void> {
  const user = await currentUser();
  const startAtUtc = new Date(String(formData.get('startUtc') ?? ''));

  if (!Number.isNaN(startAtUtc.getTime())) {
    if (user) {
      await releaseHold({ studentId: user.id, tutorId, startAtUtc });
    } else {
      const guestToken = await readGuestToken();
      if (guestToken) await releaseHold({ guestToken, tutorId, startAtUtc });
    }
  }

  revalidatePath(`/tutors/${tutorId}`);
}
