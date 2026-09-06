'use server';

/**
 * Starting and ending a standing arrangement (SPEC.md §5).
 *
 * Nothing here takes money. The series is the commitment; each occurrence is
 * charged at its own T-48h by `pnpm series`. Somebody agreeing to eight
 * sessions today pays for none of them today, which is the whole difference
 * between a commitment and a prepayment (DECISIONS_NEEDED item 32).
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createSeries, endSeries, seriesProblemMessage } from '@/db/series';
import { requireUser } from '@/lib/auth/guards';

export async function startSeries(tutorId: string, formData: FormData): Promise<void> {
  const user = await requireUser();

  const weekdays = formData.getAll('weekdays').map((value) => Number(value)).filter(Number.isInteger);
  const startTimeLocal = String(formData.get('startTimeLocal') ?? '');
  const durationMinutes = Number(formData.get('durationMinutes') ?? 60);
  const subjectId = String(formData.get('subjectId') ?? '') || null;
  const topicIds = formData.getAll('topicIds').map(String).filter(Boolean);
  const topicNote = String(formData.get('topicNote') ?? '');

  const result = await createSeries({
    studentId: user.id,
    tutorId,
    weekdays,
    startTimeLocal,
    durationMinutes,
    subjectId,
    topicIds,
    topicNote,
  });

  revalidatePath(`/tutors/${tutorId}`);
  revalidatePath('/dashboard');

  if (result.ok) redirect(`/dashboard?series=${result.seriesId}`);

  const detail =
    result.clashes && result.clashes.length > 0
      ? ` The dates that clash: ${result.clashes.join(', ')}.`
      : '';

  redirect(
    `/tutors/${tutorId}/series?error=${encodeURIComponent(
      seriesProblemMessage(result.problem) + detail,
    )}`,
  );
}

/**
 * End it, with seven days' notice.
 *
 * Either side may. Which side is doing it is taken from the session rather than
 * the form, so a student cannot end a series "as the tutor" and have the
 * cancellations land on the wrong person's record.
 */
export async function stopSeries(seriesId: string, formData: FormData): Promise<void> {
  const user = await requireUser();

  const asTutor = String(formData.get('as') ?? '') === 'tutor';
  const reason = String(formData.get('reason') ?? '').trim() || null;

  const result = await endSeries(
    seriesId,
    asTutor ? 'tutor' : 'student',
    user.id,
    reason,
  );

  revalidatePath('/dashboard');
  revalidatePath('/tutor');

  const home = asTutor ? '/tutor' : '/dashboard';
  redirect(
    result.ok
      ? `${home}?series=ended&until=${encodeURIComponent(result.endsOn)}`
      : `${home}?error=${encodeURIComponent(result.reason)}`,
  );
}
