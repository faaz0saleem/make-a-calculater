/**
 * The half of the Auth.js config that must run on the edge (middleware).
 *
 * No database, no bcrypt — those live in `src/auth.ts`, which the Node runtime
 * loads. Middleware only reads the JWT and decides whether a path is allowed.
 */

import type { NextAuthConfig } from 'next-auth';

import { isUserRole, type UserRole } from '@/lib/auth/roles';

/**
 * The JWT is a loose bag of claims, so narrow rather than cast: a token carrying
 * anything other than known role strings gets no roles at all.
 */
function rolesFromToken(value: unknown): UserRole[] {
  return Array.isArray(value) ? value.filter(isUserRole) : [];
}

/** Paths a signed-out visitor may reach. Everything else needs a session. */
const PUBLIC_PREFIXES = ['/', '/signin', '/signup', '/tutors', '/api/auth', '/api/health'];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some((prefix) => prefix !== '/' && pathname.startsWith(prefix));
}

export const authConfig = {
  pages: {
    signIn: '/signin',
    error: '/signin',
  },
  session: {
    // Credentials sign-in requires JWT sessions; the adapter still stores the
    // Google account link so the two providers resolve to one user row.
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id ?? token.sub;
        token.roles = user.roles ?? ['student'];
        token.timezone = user.timezone ?? 'UTC';
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? '';
      session.user.roles = rolesFromToken(token.roles);
      session.user.timezone = typeof token.timezone === 'string' ? token.timezone : 'UTC';
      return session;
    },
    /**
     * Route-level gate: signed out means the sign-in page.
     *
     * Role checks deliberately do not happen here. Denying at the edge sends a
     * signed-in user back to sign-in, which they have already done — a loop. The
     * page's own `requireRole` sends them somewhere useful instead, and it is
     * the real boundary anyway (SPEC.md §13.4).
     */
    authorized({ request, auth }) {
      if (isPublicPath(request.nextUrl.pathname)) return true;
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
