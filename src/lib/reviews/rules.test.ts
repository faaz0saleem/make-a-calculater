import { describe, expect, it } from 'vitest';

import {
  EMPTY_DISTRIBUTION,
  REVIEW_EDIT_WINDOW_DAYS,
  canEditReview,
  canWriteReview,
  editWindowClosesAt,
  formatStars,
  isValidRating,
  summariseRatings,
  withinEditWindow,
  type ReviewableBooking,
} from './rules';

const STUDENT = 'student-1';
const NOW = new Date('2026-04-20T12:00:00Z');
const days = (n: number) => n * 86_400_000;

const paid: ReviewableBooking = {
  studentId: STUDENT,
  isTrial: false,
  priceCents: 2_500,
  completedAt: new Date('2026-04-19T12:00:00Z'),
};

describe('canWriteReview', () => {
  it('lets the student who took a completed paid session review it', () => {
    expect(canWriteReview(paid, STUDENT, false)).toBeNull();
  });

  it('refuses anybody else, including the tutor', () => {
    expect(canWriteReview(paid, 'tutor-1', false)).toBe('not_your_session');
  });

  it('refuses a trial, which is the whole point of the rule', () => {
    expect(canWriteReview({ ...paid, isTrial: true, priceCents: 0 }, STUDENT, false)).toBe('trial');
  });

  it('refuses a session that never happened', () => {
    expect(canWriteReview({ ...paid, completedAt: null }, STUDENT, false)).toBe('not_completed');
  });

  it('refuses a second review of the same booking', () => {
    expect(canWriteReview(paid, STUDENT, true)).toBe('already_reviewed');
  });
});

describe('the edit window', () => {
  const review = { studentId: STUDENT, createdAt: NOW };

  it('is open for seven days', () => {
    expect(withinEditWindow(NOW, new Date(NOW.getTime() + days(6.9)))).toBe(true);
    expect(canEditReview(review, STUDENT, new Date(NOW.getTime() + days(6.9)))).toBeNull();
  });

  it('closes on the seventh day', () => {
    expect(withinEditWindow(NOW, new Date(NOW.getTime() + days(REVIEW_EDIT_WINDOW_DAYS)))).toBe(false);
    expect(canEditReview(review, STUDENT, new Date(NOW.getTime() + days(7)))).toBe('edit_window_closed');
  });

  it('is only the author’s to use', () => {
    expect(canEditReview(review, 'someone-else', NOW)).toBe('not_your_session');
  });

  it('says when it closes', () => {
    expect(editWindowClosesAt(NOW).toISOString()).toBe('2026-04-27T12:00:00.000Z');
  });
});

describe('isValidRating', () => {
  it('takes one to five whole stars and nothing else', () => {
    expect([1, 2, 3, 4, 5].every(isValidRating)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(4.5)).toBe(false);
    expect(isValidRating(Number.NaN)).toBe(false);
  });
});

describe('summariseRatings', () => {
  it('says nothing when there is nothing to say', () => {
    const summary = summariseRatings(EMPTY_DISTRIBUTION);
    expect(summary.count).toBe(0);
    expect(summary.rawMilli).toBeNull();
    // With no reviews the displayed rating is the prior itself.
    expect(summary.displayedMilli).toBe(4_300);
  });

  it('pulls one perfect review towards the prior', () => {
    const summary = summariseRatings({ ...EMPTY_DISTRIBUTION, 5: 1 });
    expect(summary.rawMilli).toBe(5_000);
    expect(summary.displayedMilli).toBe(4_417);
    expect(formatStars(summary.displayedMilli)).toBe('4.4');
  });

  it('lets a well-reviewed tutor approach their real average', () => {
    const summary = summariseRatings({ ...EMPTY_DISTRIBUTION, 5: 50 });
    expect(summary.displayedMilli).toBe(4_936);
    expect(formatStars(summary.displayedMilli)).toBe('4.9');
  });

  it('builds the breakdown bar', () => {
    const summary = summariseRatings({ 1: 1, 2: 0, 3: 1, 4: 2, 5: 6 });
    expect(summary.count).toBe(10);
    expect(summary.sharePercent[5]).toBe(60);
    expect(summary.sharePercent[4]).toBe(20);
    expect(summary.sharePercent[2]).toBe(0);
    expect(summary.rawMilli).toBe(4_200);
  });
});
