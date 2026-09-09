/**
 * Server-side authorization helpers (SPEC.md §13.4).
 *
 * The session is the only source of identity. Nothing in the codebase may read
 * a user id or a role out of a request body, a query string or a header.
 */

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { sessionsValidFrom } from '@/db/passwords';
import { hasRole, type UserRole } from './roles';

/**
 * One lookup per request, however many guards run.
 *
 * `cache` is React's per-render memo, so a page calling `requireUser()` in four
 * places asks the database once. Without it this would add a query to every
 * component that checks who is signed in.
 */
const validFrom = cache(sessionsValidFrom);

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  roles: UserRole[];
  timezone: string;
};

/**
 * The signed-in user, or null.
 *
 * The extra lookup is what makes "sign out everywhere" real. JWT sessions have
 * no server-side store to delete from, so a token stays valid until it expires
 * — including the one an intruder is holding while its owner resets their
 * password. Comparing the token's issue time against the account's
 * `sessions_valid_from` is the only way to refuse it.
 *
 * The middleware deliberately does not do this: it runs on the edge with no
 * database, and it is not the authorization boundary anyway (SPEC.md §13.4).
 * This is.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const cutoff = await validFrom(session.user.id);
  if (cutoff) {
    // A session that began at or before the cutoff is refused. Equality counts
    // as older: the reset happened after the session it is revoking.
    const startedAt = session.user.signedInAtMs ?? 0;
    if (startedAt <= cutoff.getTime()) return null;
  }

  return {
    id: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? '',
    roles: session.user.roles ?? [],
    timezone: session.user.timezone ?? 'UTC',
  };
}

/** For pages: bounce to sign-in when there is no session. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  return user;
}

/**
 * For pages: require a role.
 *
 * Sends a signed-in user without the role to `/dashboard` rather than showing a
 * 403, so the existence of the page is not confirmed to someone who cannot use
 * it (SPEC.md §16, last line).
 */
export async function requireRole(role: UserRole): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasRole(user.roles, role)) redirect('/dashboard');
  return user;
}

/**
 * For API routes: a missing or unauthorised session is a 404, not a 401 or 403,
 * so a caller cannot learn that a record exists (SPEC.md §16, last line).
 */
export function notFound(): Response {
  return Response.json({ error: 'Not found' }, { status: 404 });
}
