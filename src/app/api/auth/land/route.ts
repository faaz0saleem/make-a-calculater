/**
 * Where a fresh sign-in lands before it goes anywhere else.
 *
 * Two things have to happen exactly once, after the session exists and before
 * the person sees a page, and neither can happen while a server component is
 * rendering: claiming the slot they held as a guest, and clearing the cookies
 * that carried them across the round trip.
 *
 * So sign-in and sign-up both redirect here, and here redirects on. That keeps
 * "the slot you picked is still yours" a single, testable step rather than
 * something every landing page has to remember to do.
 */

import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { claimGuestHolds } from '@/db/bookings';
import { GUEST_COOKIE } from '@/lib/bookings/guest';

export const dynamic = 'force-dynamic';

/** Only our own paths. An open redirect is a phishing tool. */
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(next)}`, url.origin));
  }

  const guestToken = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GUEST_COOKIE}=`))
    ?.slice(GUEST_COOKIE.length + 1);

  if (guestToken && /^[0-9a-f-]{36}$/i.test(guestToken)) {
    // A hold that expired while they were filling in the form is simply not
    // claimed. Ten minutes is ten minutes.
    await claimGuestHolds(guestToken, session.user.id);
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  response.cookies.delete(GUEST_COOKIE);
  response.cookies.delete('tutorly_signup');
  return response;
}
