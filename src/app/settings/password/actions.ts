'use server';

/**
 * Changing a password from inside the account (SPEC.md §1).
 *
 * Which account comes from the session; the current password comes from the
 * form. Both are required, and that is the whole design: a session left open on
 * a shared computer is not authority to lock its owner out of their own
 * account.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refreshSession } from '@/auth';
import { changePassword } from '@/db/passwords';
import { requireUser } from '@/lib/auth/guards';

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  const fail = (message: string): never =>
    redirect(`/settings/password?error=${encodeURIComponent(message)}`);

  if (newPassword !== confirm) fail('Those two do not match.');

  const result = await changePassword({ userId: user.id, currentPassword, newPassword });
  if (!result.ok) fail(result.message);

  // `changePassword` has just moved `sessions_valid_from` past every session
  // that exists, this one included. Re-stamping this browser's token is what
  // makes the promise on the page true: everywhere else is signed out, and the
  // device the change was made on is not. It happens after the write, so the
  // new stamp is provably later than the cutoff.
  await refreshSession({});

  revalidatePath('/settings/password');
  redirect('/settings/password?done=1');
}
