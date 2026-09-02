/**
 * Route gate. Runs on the edge with the JWT only — see `src/auth.config.ts`.
 *
 * This keeps signed-out visitors out of member pages. It is NOT the security
 * boundary: every server query re-checks who owns the row it is about to return
 * (SPEC.md §13.4).
 */

import NextAuth from 'next-auth';

import { authConfig } from '@/auth.config';

export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|mp4)$).*)'],
};
