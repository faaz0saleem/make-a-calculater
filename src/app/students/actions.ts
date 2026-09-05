'use server';

/**
 * The answers a student gives after signing up, each at the moment it pays them
 * back.
 *
 * Nothing here is a gate. Every one of these can be skipped, and skipping costs
 * the student nothing but a slightly worse feed or a missing reminder — which
 * is the whole design: the signup form asks three questions, and everything
 * else earns its place.
 *
 * Who is answering always comes from the session.
 */

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { correctInferredPlace, saveStudentPhone } from '@/db/students';
import { requireUser } from '@/lib/auth/guards';
import {
  CURRICULUM_PROMPT_COOKIE,
  CURRICULUM_PROMPT_DISMISS_DAYS,
} from '@/lib/students/prompts';
import { isValidTimeZone } from '@/lib/time';

/** "Not now" on the feed's class prompt. See `@/lib/students/prompts`. */
export async function dismissCurriculumPrompt(formData: FormData): Promise<void> {
  const returnTo = String(formData.get('returnTo') ?? '/') || '/';

  (await cookies()).set(CURRICULUM_PROMPT_COOKIE, 'later', {
    path: '/',
    maxAge: 60 * 60 * 24 * CURRICULUM_PROMPT_DISMISS_DAYS,
    sameSite: 'lax',
    httpOnly: true,
  });

  revalidatePath('/');
  redirect(returnTo);
}

/**
 * A phone number, asked for as WhatsApp reminders rather than as a field.
 *
 * The framing is the point. "Phone number" is a tax somebody pays us; "text me
 * before my lesson" is a thing they want, and it is the same column.
 */
export async function saveReminderPreference(formData: FormData): Promise<void> {
  const user = await requireUser();
  const phone = String(formData.get('phone') ?? '');
  const returnTo = String(formData.get('returnTo') ?? '/dashboard') || '/dashboard';

  const ok = await saveStudentPhone(user.id, phone);

  revalidatePath('/dashboard');
  redirect(
    ok
      ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}reminders=1`
      : `${returnTo}${returnTo.includes('?') ? '&' : '?'}reminderError=1`,
  );
}

/** Correct the country or timezone we guessed from the browser. */
export async function correctPlace(formData: FormData): Promise<void> {
  const user = await requireUser();

  const country = String(formData.get('country') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? '').trim();
  const returnTo = String(formData.get('returnTo') ?? '/dashboard') || '/dashboard';

  await correctInferredPlace(user.id, {
    country: /^[A-Za-z]{2}$/.test(country) ? country : null,
    timezone: timezone && isValidTimeZone(timezone) ? timezone : null,
  });

  revalidatePath('/');
  revalidatePath('/dashboard');
  redirect(returnTo);
}
