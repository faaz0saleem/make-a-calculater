'use server';

/**
 * Filing a report (SPEC.md §10).
 *
 * Anyone signed in can report a tutor, a student, a message or a session. The
 * reporter is taken from the session, never from the form — a report is an
 * accusation, and one that could be filed under somebody else's name would be a
 * weapon.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { fileReport, type FileReportInput } from '@/db/reports';
import { requireUser } from '@/lib/auth/guards';

const TARGETS: FileReportInput['targetType'][] = [
  'user',
  'tutor_profile',
  'booking',
  'review',
  'message',
];

export async function fileReportAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const targetType = String(formData.get('targetType') ?? '') as FileReportInput['targetType'];
  const targetId = String(formData.get('targetId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const returnTo = String(formData.get('returnTo') ?? '/dashboard');

  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard';

  if (!TARGETS.includes(targetType) || !targetId || !reason) {
    redirect(`${safeReturn}?error=${encodeURIComponent('Pick a reason before sending a report.')}`);
  }

  const result = await fileReport({
    reporterId: user.id,
    targetType,
    targetId,
    reason,
    body: body || null,
  });

  revalidatePath('/admin/reports');
  revalidatePath('/admin');

  redirect(
    result.ok
      ? `${safeReturn}?reported=1`
      : `${safeReturn}?error=${encodeURIComponent(result.reason)}`,
  );
}
