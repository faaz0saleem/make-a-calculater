/**
 * Who is visible, and who can be booked (SPEC.md §1, §3).
 *
 * "An unverified tutor is invisible in search and the feed and cannot be
 * booked." That is one rule, so it lives in one place. The feed query, the
 * search query, the public profile page and — from Phase 3 — the booking
 * mutation all ask these functions rather than writing their own status check.
 */

import { BOOKABLE_TUTOR_STATUS, type TutorStatus } from './status';

export type TutorVisibility = {
  status: TutorStatus;
  /** Set when an admin suspends the account itself, separately from the profile. */
  userSuspendedAt: Date | null;
};

export type Viewer = {
  id: string;
  roles: readonly string[];
} | null;

/**
 * Whether the tutor appears in the feed, in search results, and on a public
 * profile page.
 */
export function isPubliclyVisible(tutor: TutorVisibility): boolean {
  return tutor.status === BOOKABLE_TUTOR_STATUS && tutor.userSuspendedAt === null;
}

export type BookabilityProblem = 'not_verified' | 'suspended';

/** Why a tutor cannot be booked, or null when they can. */
export function bookabilityProblem(tutor: TutorVisibility): BookabilityProblem | null {
  if (tutor.userSuspendedAt !== null) return 'suspended';
  if (tutor.status !== BOOKABLE_TUTOR_STATUS) return 'not_verified';
  return null;
}

export function isBookable(tutor: TutorVisibility): boolean {
  return bookabilityProblem(tutor) === null;
}

export class TutorNotBookableError extends Error {
  readonly problem: BookabilityProblem;

  constructor(problem: BookabilityProblem) {
    super(
      problem === 'suspended'
        ? 'This tutor is not currently taking bookings.'
        : 'This tutor has not completed verification yet.',
    );
    this.name = 'TutorNotBookableError';
    this.problem = problem;
  }
}

/**
 * The gate every booking mutation goes through. Throws rather than returning a
 * flag, so a caller cannot forget to check the result.
 */
export function assertBookable(tutor: TutorVisibility): void {
  const problem = bookabilityProblem(tutor);
  if (problem) throw new TutorNotBookableError(problem);
}

/**
 * Whether a specific viewer may see a profile that is not public yet.
 *
 * A tutor can always see their own profile — that is how they preview it before
 * submitting — and an admin can see any of them, which is what the verification
 * screen needs. Everybody else gets a 404, never a 403 (SPEC.md §16).
 */
export function canViewPrivately(tutorId: string, viewer: Viewer): boolean {
  if (!viewer) return false;
  if (viewer.roles.includes('admin')) return true;
  return viewer.id === tutorId;
}

export function canViewProfile(tutorId: string, tutor: TutorVisibility, viewer: Viewer): boolean {
  return isPubliclyVisible(tutor) || canViewPrivately(tutorId, viewer);
}
