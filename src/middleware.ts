/**
 * Route gate, plus one small piece of discovery state.
 *
 * The gate keeps signed-out visitors out of member pages — see
 * `src/auth.config.ts`. It is NOT the security boundary: every server query
 * re-checks who owns the row it is about to return (SPEC.md §13.4).
 *
 * It also remembers the last subject a visitor browsed, which is what the
 * "Top rated in {your last searched subject}" rail reads (SPEC.md §4). A cookie
 * rather than a database row: it is a browsing convenience, it must work for
 * signed-out visitors, and nothing else should depend on it.
 */

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig } from '@/auth.config';

export const LAST_SUBJECT_COOKIE = 'tutorly_last_subject';

/** Subject slugs only — this value is read back and used in a query. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const response = NextResponse.next();

  const subject = request.nextUrl.searchParams.get('subject');
  if (subject && SLUG_PATTERN.test(subject)) {
    response.cookies.set(LAST_SUBJECT_COOKIE, subject, {
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
      httpOnly: true,
    });
  }

  return response;
});

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|mp4|m3u8|ts)$).*)'],
};
