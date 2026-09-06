'use server';

/**
 * What happened in a session, recorded afterwards (SPEC.md §4, §9).
 *
 * Both actions are scoped to the tutor on the booking inside the query, so a
 * booking id from somebody else's session writes nothing.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { assignHomework, markHomework } from '@/db/homework';
import { markCoverage, type CoverageMark } from '@/db/topics';
import { requireRole } from '@/lib/auth/guards';

const GRASP = ['struggling', 'developing', 'secure'] as const;

function back(bookingId: string, query: string): never {
  redirect(`/tutor/sessions/${bookingId}?${query}`);
}

export async function recordCoverage(bookingId: string, formData: FormData): Promise<void> {
  const tutor = await requireRole('tutor');

  const topicIds = formData.getAll('topicId').map(String).filter(Boolean);
  const marks: CoverageMark[] = topicIds.map((topicId) => {
    const grasp = String(formData.get(`grasp:${topicId}`) ?? '');
    return {
      topicId,
      covered: formData.get(`covered:${topicId}`) === 'on',
      grasp: (GRASP as readonly string[]).includes(grasp)
        ? (grasp as CoverageMark['grasp'])
        : null,
    };
  });

  const result = await markCoverage(bookingId, tutor.id, marks);

  revalidatePath(`/tutor/sessions/${bookingId}`);
  revalidatePath('/tutor');

  back(bookingId, result.ok ? 'saved=coverage' : `error=${encodeURIComponent(result.reason ?? '')}`);
}

export async function setHomework(bookingId: string, formData: FormData): Promise<void> {
  const tutor = await requireRole('tutor');

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const topicId = String(formData.get('topicId') ?? '') || null;
  const dueRaw = String(formData.get('dueAt') ?? '').trim();

  // A date input gives a local date with no time. End of that day is what
  // "due Friday" means to everybody who is not a computer.
  const dueAt = dueRaw ? new Date(`${dueRaw}T23:59:00Z`) : null;

  const result = await assignHomework({
    bookingId,
    tutorId: tutor.id,
    title,
    body: body || null,
    topicId,
    dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
  });

  revalidatePath(`/tutor/sessions/${bookingId}`);
  revalidatePath('/tutor/homework');

  back(bookingId, result.ok ? 'saved=homework' : `error=${encodeURIComponent(result.reason)}`);
}

export async function markSubmission(
  bookingId: string,
  homeworkId: string,
  formData: FormData,
): Promise<void> {
  const tutor = await requireRole('tutor');

  const markRaw = String(formData.get('mark') ?? '').trim();
  const outOfRaw = String(formData.get('markOutOf') ?? '').trim();

  const result = await markHomework({
    homeworkId,
    tutorId: tutor.id,
    mark: markRaw === '' ? null : Number(markRaw),
    markOutOf: outOfRaw === '' ? null : Number(outOfRaw),
    feedback: String(formData.get('feedback') ?? ''),
  });

  revalidatePath(`/tutor/sessions/${bookingId}`);
  revalidatePath('/tutor/homework');

  back(bookingId, result.ok ? 'saved=marked' : `error=${encodeURIComponent(result.reason ?? '')}`);
}
