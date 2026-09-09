'use server';

/**
 * Email preferences (SPEC.md §11).
 *
 * Which user is being changed comes from the session, never from the form. A
 * preferences page that took a user id from a hidden field would let anybody
 * silence anybody else's reminders.
 */

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { resubscribeAll, setEmailPreference, unsubscribe } from '@/db/email';
import { changeEmail, requestEmailVerification } from '@/db/verification';
import { requireUser } from '@/lib/auth/guards';
import { VERIFY_BANNER_COOKIE, VERIFY_BANNER_SNOOZE_DAYS } from '@/lib/auth/verification';
import { isEmailKind, isOptionalEmail } from '@/lib/email/kinds';
import { clientIp, rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

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

// ---------------------------------------------------------------------------
// The address itself (SPEC.md §1)
// ---------------------------------------------------------------------------

const VERIFY_DONE: Record<string, string> = {
  already_verified: 'verified',
  rate_limited: 'verify-too-many',
  no_such_user: 'verify-failed',
};

/**
 * Ask for another confirmation link.
 *
 * Rate limited twice for the same reason the reset is: per account in
 * `requestEmailVerification`, and per IP here. This one is reachable only from
 * a session, so the account limit does most of the work — the IP limit is what
 * stops one machine holding a hundred sessions.
 */
export async function resendVerificationAction(): Promise<void> {
  const user = await requireUser();

  const ip = clientIp(await headers());
  const limit = rateLimit(`verify:${ip}`, RATE_LIMITS.auth);
  if (!limit.ok) redirect('/settings/email?done=verify-too-many');

  const result = await requestEmailVerification({ userId: user.id });

  revalidatePath('/settings/email');
  redirect(`/settings/email?done=${result.sent ? 'verify-sent' : VERIFY_DONE[result.reason] ?? 'verify-failed'}`);
}

/**
 * Stop showing the banner for a while.
 *
 * A while, not forever. The cookie expires, so somebody who dismissed it in
 * March is nudged again in April rather than never — this is the one thing
 * standing between a tutor and a payout they cannot request, and a banner that
 * can be silenced permanently is a support ticket waiting to happen.
 *
 * A cookie rather than a column on purpose: it is a per-browser preference
 * about a piece of chrome, not a fact about the account, and writing it to the
 * database would make dismissing it on a laptop hide it on a phone.
 */
export async function dismissVerifyBannerAction(): Promise<void> {
  await requireUser();

  const jar = await cookies();
  jar.set(VERIFY_BANNER_COOKIE, '1', {
    maxAge: VERIFY_BANNER_SNOOZE_DAYS * 24 * 60 * 60,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}

export async function changeEmailAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const newEmail = String(formData.get('email') ?? '');
  const currentPassword = String(formData.get('currentPassword') ?? '');

  const result = await changeEmail({ userId: user.id, currentPassword, newEmail });
  if (!result.ok) redirect(`/settings/email?error=${encodeURIComponent(result.message)}`);

  // The old dismissal was about the old address. A new one starts the nudge again.
  (await cookies()).delete(VERIFY_BANNER_COOKIE);

  revalidatePath('/settings/email');
  revalidatePath('/', 'layout');
  redirect('/settings/email?done=address-changed');
}
