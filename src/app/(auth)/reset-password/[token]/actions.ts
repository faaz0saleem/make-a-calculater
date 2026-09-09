'use server';

/**
 * Using a reset link (SPEC.md §1).
 *
 * The token comes from the URL and the new password from the form; no user id
 * is accepted from anywhere, because the token *is* the identity claim and a
 * form field beside it would be a second, weaker one.
 */

import { redirect } from 'next/navigation';

import { completePasswordReset } from '@/db/passwords';

export async function resetPasswordAction(token: string, formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password !== confirm) {
    redirect(
      `/reset-password/${encodeURIComponent(token)}?error=${encodeURIComponent(
        'Those two do not match.',
      )}`,
    );
  }

  const result = await completePasswordReset({ token, password });

  if (!result.ok) {
    redirect(
      `/reset-password/${encodeURIComponent(token)}?error=${encodeURIComponent(result.message)}`,
    );
  }

  // Not signed in automatically. Somebody who has just been locked out should
  // see the sign-in page work with their new password — that is the proof the
  // reset took, and it costs one screen.
  redirect('/signin?reset=1');
}
