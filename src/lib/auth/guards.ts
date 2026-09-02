/**
 * Server-side authorization helpers (SPEC.md §13.4).
 *
 * The session is the only source of identity. Nothing in the codebase may read
 * a user id or a role out of a request body, a query string or a header.
 */

import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { hasRole, type UserRole } from './roles';

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  roles: UserRole[];
  timezone: string;
};

/** The signed-in user, or null. */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

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
