/**
 * Tutor profile statuses and the transitions between them (SPEC.md §3).
 *
 * Same discipline as the booking state machine: one function owns the change,
 * and an illegal move throws rather than writing a bad row.
 *
 *   draft ──submit──▶ pending_review ──approve──▶ verified
 *                          │                        │
 *                       reject                   suspend
 *                          ▼                        ▼
 *                       rejected ◀──────────────  suspended
 *                          │
 *                     resubmit (SPEC.md §3: rejection must allow resubmission)
 *                          ▼
 *                    pending_review
 */

export const TUTOR_STATUSES = ['draft', 'pending_review', 'verified', 'rejected', 'suspended'] as const;

export type TutorStatus = (typeof TUTOR_STATUSES)[number];

/** The only status that appears in the feed, in search, and can be booked. */
export const BOOKABLE_TUTOR_STATUS: TutorStatus = 'verified';

const TRANSITIONS: Record<TutorStatus, readonly TutorStatus[]> = {
  // The tutor submits a finished profile.
  draft: ['pending_review'],
  // An admin decides; the tutor may also pull it back to keep editing.
  pending_review: ['verified', 'rejected', 'draft'],
  // A verified tutor can be suspended, and nothing else.
  verified: ['suspended'],
  // Rejection names a reason and always allows another attempt.
  rejected: ['pending_review', 'draft'],
  // Suspension is reversible, or it becomes permanent.
  suspended: ['verified', 'rejected'],
};

export class TutorTransitionError extends Error {
  readonly from: TutorStatus;
  readonly to: TutorStatus;

  constructor(from: TutorStatus, to: TutorStatus) {
    super(`illegal tutor status transition: ${from} -> ${to}`);
    this.name = 'TutorTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransitionTutor(from: TutorStatus, to: TutorStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The one function that changes a tutor's status. */
export function transitionTutor(from: TutorStatus, to: TutorStatus): TutorStatus {
  if (!canTransitionTutor(from, to)) {
    throw new TutorTransitionError(from, to);
  }
  return to;
}

/** Whether the tutor may still edit their profile through the wizard. */
export function isEditable(status: TutorStatus): boolean {
  return status === 'draft' || status === 'rejected';
}

/** Whether the profile is sitting in the admin queue. */
export function isAwaitingReview(status: TutorStatus): boolean {
  return status === 'pending_review';
}
