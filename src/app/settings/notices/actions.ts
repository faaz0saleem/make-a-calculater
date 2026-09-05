'use server';

/**
 * Reading and answering a notice (SPEC.md §8).
 *
 * Both actions are scoped to the signed-in user inside the query itself, so
 * posting somebody else's notice id acknowledges nothing.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { acknowledgeSanction, appealSanction } from '@/db/reports';
import { requireUser } from '@/lib/auth/guards';

export async function acknowledgeNotice(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sanctionId = String(formData.get('sanctionId') ?? '');

  if (sanctionId) await acknowledgeSanction(sanctionId, user.id);

  revalidatePath('/settings/notices');
  redirect('/settings/notices?done=read');
}

export async function appealNotice(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sanctionId = String(formData.get('sanctionId') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (!note) redirect('/settings/notices?error=' + encodeURIComponent('Tell us what we got wrong.'));

  const result = await appealSanction(sanctionId, user.id, note);

  revalidatePath('/settings/notices');
  redirect(result.ok ? '/settings/notices?done=appealed' : '/settings/notices?error=Something+went+wrong');
}
