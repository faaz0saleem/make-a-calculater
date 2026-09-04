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

import { followTutor, unfollowTutor } from '@/db/follows';
import { requestTrial } from '@/db/trials';
import { requireUser } from '@/lib/auth/guards';
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
