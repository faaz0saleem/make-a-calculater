'use server';

/**
 * Email preferences (SPEC.md §11).
 *
 * Which user is being changed comes from the session, never from the form. A
 * preferences page that took a user id from a hidden field would let anybody
 * silence anybody else's reminders.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { resubscribeAll, setEmailPreference, unsubscribe } from '@/db/email';
import { requireUser } from '@/lib/auth/guards';
import { isEmailKind, isOptionalEmail } from '@/lib/email/kinds';

export async function updateEmailPreferences(formData: FormData): Promise<void> {
  const user = await requireUser();

  // A checkbox that is off sends nothing, so the set of kinds is taken from the
  // form's own hidden list rather than from which boxes came back ticked.
  const offered = formData.getAll('kinds').map(String).filter(isEmailKind);
  const enabled = new Set(formData.getAll('enabled').map(String));

  for (const kind of offered) {
    if (!isOptionalEmail(kind)) continue;
    await setEmailPreference(user.id, kind, enabled.has(kind));
  }

  if (formData.get('resubscribe') === 'yes') await resubscribeAll(user.id);

  revalidatePath('/settings/email');
  redirect('/settings/email?done=saved');
}

export async function unsubscribeFromEverything(): Promise<void> {
  const user = await requireUser();
  await unsubscribe(user.id, 'all');

  revalidatePath('/settings/email');
  redirect('/settings/email?done=unsubscribed');
}
