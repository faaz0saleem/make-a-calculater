import { describe, expect, it } from 'vitest';

import {
  canTransitionTutor,
  isAwaitingReview,
  isEditable,
  transitionTutor,
  TutorTransitionError,
  TUTOR_STATUSES,
} from './status';

describe('tutor status machine', () => {
  it('walks draft -> pending_review -> verified', () => {
    expect(transitionTutor('draft', 'pending_review')).toBe('pending_review');
    expect(transitionTutor('pending_review', 'verified')).toBe('verified');
  });

  it('lets a rejected tutor fix the problem and resubmit (SPEC.md §3)', () => {
    expect(transitionTutor('pending_review', 'rejected')).toBe('rejected');
    expect(transitionTutor('rejected', 'pending_review')).toBe('pending_review');
  });

  it('will not verify straight from draft — an admin has to look at it', () => {
    expect(() => transitionTutor('draft', 'verified')).toThrow(TutorTransitionError);
  });

  it('will not let a tutor verify themselves out of rejection', () => {
    expect(() => transitionTutor('rejected', 'verified')).toThrow(TutorTransitionError);
  });

  it('suspends and reinstates a verified tutor', () => {
    expect(transitionTutor('verified', 'suspended')).toBe('suspended');
    expect(transitionTutor('suspended', 'verified')).toBe('verified');
  });

  it('lets a tutor withdraw a submission to keep editing', () => {
    expect(transitionTutor('pending_review', 'draft')).toBe('draft');
  });

  it('never allows a status to transition to itself', () => {
    for (const status of TUTOR_STATUSES) {
      expect(canTransitionTutor(status, status)).toBe(false);
    }
  });

  it('knows who may still edit', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('rejected')).toBe(true);
    expect(isEditable('pending_review')).toBe(false);
    expect(isEditable('verified')).toBe(false);
    expect(isEditable('suspended')).toBe(false);
  });

  it('knows what is in the admin queue', () => {
    expect(isAwaitingReview('pending_review')).toBe(true);
    expect(isAwaitingReview('draft')).toBe(false);
  });
});
