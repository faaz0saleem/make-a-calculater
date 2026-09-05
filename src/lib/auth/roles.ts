/**
 * Roles are a set, not a column (SPEC.md §1). One account can be a student and a
 * tutor at the same time.
 *
 * Every check here takes the roles from the server-side session. Nothing in this
 * file may be fed a role that arrived in a request body.
 */

export const USER_ROLES = ['student', 'tutor', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function hasRole(roles: readonly UserRole[] | undefined, role: UserRole): boolean {
  return Boolean(roles?.includes(role));
}

export function isAdmin(roles: readonly UserRole[] | undefined): boolean {
  return hasRole(roles, 'admin');
}

export function isTutor(roles: readonly UserRole[] | undefined): boolean {
  return hasRole(roles, 'tutor');
}

export function isStudent(roles: readonly UserRole[] | undefined): boolean {
  return hasRole(roles, 'student');
}

/** Where a user lands after signing in, most privileged surface first. */
export function defaultLandingPath(roles: readonly UserRole[] | undefined): string {
  if (isAdmin(roles)) return '/admin';
  if (isTutor(roles)) return '/tutor';
  return '/dashboard';
}
