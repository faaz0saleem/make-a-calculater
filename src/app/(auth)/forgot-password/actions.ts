'use server';

/**
 * Asking for a reset link (SPEC.md §1).
 *
 * The response is identical whether the address exists, does not exist, or has
 * asked three times in the last quarter hour. That is not politeness — an
 * endpoint that answers differently is a way to find out which addresses on a
 * leaked list have Tutorly accounts, and those people then get a much better
 * phishing email than they would have otherwise.
 *
 * Rate limited twice, by IP here and by address in `requestPasswordReset`.
 * Neither alone is enough: one IP walking a list of addresses defeats the
 * address limit, and a botnet aimed at one person defeats the IP limit.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestPasswordReset } from '@/db/passwords';
import { clientIp, rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function requestResetAction(formData: FormData): Promise<void> {
  const ip = clientIp(await headers());
  const email = String(formData.get('email') ?? '');

  const limit = rateLimit(`reset:${ip}`, RATE_LIMITS.auth);

  // Even the rate-limited case lands on the same page with the same words.
  // Telling somebody they are being throttled tells them the endpoint noticed
  // them, which is one bit more than they need.
  if (limit.ok) await requestPasswordReset({ email, ip });

  redirect('/forgot-password?sent=1');
}
