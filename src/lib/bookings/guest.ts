/**
 * The visitor who has not signed up yet.
 *
 * Browsing, opening a profile and picking a time all work signed out, because
 * asking somebody to create an account before they have seen a price is asking
 * them to trust us for nothing. Auth arrives at the one moment it has to: the
 * commit.
 *
 * Between picking a slot and having an account there is a round trip through a
 * form, and the slot has to survive it. This cookie is what identifies the
 * person across it.
 *
 * It is **not a credential**. It authorises nothing: the only thing it can do
 * is claim a ten-minute hold on a slot whose held-ness is already public, and
 * hand that hold to whichever account signs up next in the same browser. Every
 * query that reads it is scoped to a hold row.
 */

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

export const GUEST_COOKIE = 'tutorly_guest';

/** How long a guest token lives. Long enough to sign up, not long enough to matter. */
const GUEST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

/** The token already in the jar, or null. Never creates one. */
export async function readGuestToken(): Promise<string | null> {
  const value = (await cookies()).get(GUEST_COOKIE)?.value ?? null;
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/**
 * The token, creating one if there is none.
 *
 * Only callable from a server action or route handler — Next forbids setting a
 * cookie while rendering, which is the right constraint: a token should be
 * minted when somebody *does* something, not when they look at a page.
 */
export async function ensureGuestToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;

  const token = randomUUID();
  jar.set(GUEST_COOKIE, token, {
    path: '/',
    maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: true,
  });

  return token;
}

export async function clearGuestToken(): Promise<void> {
  (await cookies()).delete(GUEST_COOKIE);
}
