/**
 * The half of the Auth.js config that must run on the edge (middleware).
 *
 * No database, no bcrypt — those live in `src/auth.ts`, which the Node runtime
 * loads. Middleware only reads the JWT and decides whether a path is allowed.
 */

import type { NextAuthConfig } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

import { isPublicPath } from '@/lib/auth/public-paths';
import { isUserRole, type UserRole } from '@/lib/auth/roles';

/**
 * Record when this session began, in epoch milliseconds.
 *
 * Deliberately ours rather than the JWT's own `iat`. Auth.js re-encodes the
 * token on *every* session read and `encode()` calls `setIssuedAt()`, so `iat`
 * is always a few milliseconds old and can never be older than a password
 * reset. Building "sign out everywhere" on it produced a check that ran,
 * passed, and protected nothing; the e2e suite is what found it.
 *
 * Written only at a real sign-in or on an explicit update, and otherwise left
 * alone, so it means what it says: when this session began.
 *
 * Milliseconds, not seconds. `changePassword` writes the cutoff and *then*
 * asks for the update, so a millisecond stamp is provably after it; a
 * second-granularity one would land in the same second and sign the person out
 * of the device they were typing on.
 *
 * Exported because `src/auth.ts` replaces this file's `jwt` callback wholesale
 * — the Node runtime needs the database for roles — and a stamp written in only
 * one of the two would be a stamp that is never written where it matters.
 */
export function stampSessionStart(
  token: JWT,
  where: { isSignIn: boolean; isUpdate: boolean },
): void {
  if (where.isSignIn || where.isUpdate) token.signedInAtMs = Date.now();
}

/**
 * The JWT is a loose bag of claims, so narrow rather than cast: a token carrying
 * anything other than known role strings gets no roles at all.
 */
function rolesFromToken(value: unknown): UserRole[] {
  return Array.isArray(value) ? value.filter(isUserRole) : [];
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
    jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id ?? token.sub;
        token.roles = user.roles ?? ['student'];
        token.timezone = user.timezone ?? 'UTC';
      }

      stampSessionStart(token, { isSignIn: Boolean(user), isUpdate: trigger === 'update' });
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? '';
      session.user.roles = rolesFromToken(token.roles);
      session.user.timezone = typeof token.timezone === 'string' ? token.timezone : 'UTC';
      // A token with no stamp is one issued before this existed. Zero means
      // "older than any cutoff", so it is refused wherever a cutoff exists —
      // the safe direction to be wrong in.
      session.user.signedInAtMs = typeof token.signedInAtMs === 'number' ? token.signedInAtMs : 0;
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
