/**
 * SPEC.md §3: "An unverified tutor is invisible in search and the feed and
 * cannot be booked." These are the rules that sentence turns into.
 */

import { describe, expect, it } from 'vitest';

import { TUTOR_STATUSES, type TutorStatus } from './status';
import {
  assertBookable,
  bookabilityProblem,
  canViewPrivately,
  canViewProfile,
  isBookable,
  isPubliclyVisible,
  TutorNotBookableError,
} from './visibility';

const TUTOR_ID = 'tutor-1';

function tutor(status: TutorStatus, userSuspendedAt: Date | null = null) {
  return { status, userSuspendedAt };
}

describe('public visibility', () => {
  it('shows verified tutors and nobody else', () => {
    for (const status of TUTOR_STATUSES) {
      expect(isPubliclyVisible(tutor(status))).toBe(status === 'verified');
    }
  });

  it('hides a verified tutor whose account has been suspended', () => {
    expect(isPubliclyVisible(tutor('verified', new Date()))).toBe(false);
  });
});

describe('bookability', () => {
  it('allows only verified tutors', () => {
    for (const status of TUTOR_STATUSES) {
      expect(isBookable(tutor(status))).toBe(status === 'verified');
    }
  });

  it('names why a draft or pending tutor cannot be booked', () => {
    expect(bookabilityProblem(tutor('draft'))).toBe('not_verified');
    expect(bookabilityProblem(tutor('pending_review'))).toBe('not_verified');
    expect(bookabilityProblem(tutor('rejected'))).toBe('not_verified');
    expect(bookabilityProblem(tutor('verified'))).toBeNull();
  });

  it('treats a suspended account as suspended, whatever the profile says', () => {
    expect(bookabilityProblem(tutor('verified', new Date()))).toBe('suspended');
    expect(bookabilityProblem(tutor('pending_review', new Date()))).toBe('suspended');
  });

  it('throws for an unverified tutor, so a caller cannot forget to check', () => {
    expect(() => assertBookable(tutor('pending_review'))).toThrow(TutorNotBookableError);
    expect(() => assertBookable(tutor('verified'))).not.toThrow();
  });

  it('explains itself without blaming the student', () => {
    try {
      assertBookable(tutor('draft'));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as TutorNotBookableError).problem).toBe('not_verified');
      expect((error as Error).message).toContain('verification');
    }
  });
});

describe('who may see an unpublished profile', () => {
  it('lets a tutor preview their own', () => {
    expect(canViewPrivately(TUTOR_ID, { id: TUTOR_ID, roles: ['tutor'] })).toBe(true);
  });

  it('lets an admin open anyone, which is what the review screen needs', () => {
    expect(canViewPrivately(TUTOR_ID, { id: 'admin-1', roles: ['admin'] })).toBe(true);
  });

  it('shuts out other tutors, students and signed-out visitors', () => {
    expect(canViewPrivately(TUTOR_ID, { id: 'tutor-2', roles: ['tutor'] })).toBe(false);
    expect(canViewPrivately(TUTOR_ID, { id: 'student-1', roles: ['student'] })).toBe(false);
    expect(canViewPrivately(TUTOR_ID, null)).toBe(false);
  });

  it('combines with public visibility for the profile page', () => {
    // Verified: everybody, including signed-out.
    expect(canViewProfile(TUTOR_ID, tutor('verified'), null)).toBe(true);
    // Pending: only the tutor and admins.
    expect(canViewProfile(TUTOR_ID, tutor('pending_review'), null)).toBe(false);
    expect(canViewProfile(TUTOR_ID, tutor('pending_review'), { id: TUTOR_ID, roles: ['tutor'] })).toBe(true);
    expect(canViewProfile(TUTOR_ID, tutor('pending_review'), { id: 'x', roles: ['admin'] })).toBe(true);
    expect(canViewProfile(TUTOR_ID, tutor('pending_review'), { id: 'x', roles: ['student'] })).toBe(false);
  });
});
