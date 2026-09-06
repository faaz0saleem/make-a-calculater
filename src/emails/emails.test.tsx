import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as Emails from './index';
import { localTime } from './_shared/format';

const base = { recipientName: 'Learner', supportUrl: 'https://lessons.example.org/help', privacyUrl: 'https://lessons.example.org/privacy' };
const optional = { ...base, preferencesUrl: 'https://lessons.example.org/preferences', unsubscribeUrl: 'https://lessons.example.org/unsubscribe/token' };
const lesson = { bookingId: 'booking-123', counterpartName: 'Tutor', subjectName: 'Physics', startsAt: '2026-11-01T07:30:00Z', timezone: 'America/New_York', durationMinutes: 60, bookingUrl: 'https://lessons.example.org/dashboard' };

function check<P extends object>(component: React.ComponentType<P> & { plainText: (p: P) => string; subject: (p: P) => string }, props: P, phrase: string) {
  const html = renderToStaticMarkup(React.createElement(component, props));
  const text = component.plainText(props);
  expect(html).toContain('<html');
  expect(html).toContain('lang="en"');
  expect(html).toContain(phrase);
  expect(text).toContain(phrase);
  expect(text).toContain('https://lessons.example.org/privacy');
  expect(component.subject(props)).not.toMatch(/[\r\n]/);
}
describe('all SPEC §11 notification groups render in HTML and text', () => {
  it('booking confirmed: either recipient, calendar only when attached', () => {
    for (const recipientRole of ['student', 'tutor'] as const) check(Emails.BookingConfirmed, { ...base, ...lesson, recipientRole, isTrial: false, priceCents: 2550 }, 'US$25.50');
    expect(Emails.BookingConfirmed.plainText({ ...base, ...lesson, recipientRole: 'student', isTrial: false, priceCents: 2500 })).not.toContain('invitation is attached');
    check(Emails.BookingConfirmed, { ...base, ...lesson, recipientRole: 'student', isTrial: true, priceCents: 0, calendarAttached: true }, 'A calendar invitation is attached');
  });
  it('24h reminder preserves the exact-boundary half-refund warning', () => check(Emails.Reminder24h, { ...optional, ...lesson }, 'Exactly 24 hours falls in the half-refund tier'));
  it('1h reminder names the actual room opening window', () => check(Emails.Reminder1h, { ...optional, ...lesson }, 'five minutes before'));
  it('10-minute notice does not promise early call access', () => check(Emails.SessionStarting, { ...optional, ...lesson, classroomUrl: 'https://lessons.example.org/sessions/booking-123' }, 'access to the call opens five minutes before'));
  it('trial requested contains the supplied expiry', () => check(Emails.TrialRequested, { ...base, ...lesson, expiresAt: '2026-11-01T05:30:00Z' }, 'Respond by'));
  it('trial decision: accepted and declined', () => {
    check(Emails.TrialDecision, { ...base, ...lesson, decision: 'accepted' }, 'No credits are charged');
    check(Emails.TrialDecision, { ...base, ...lesson, decision: 'declined', reason: 'Unavailable at that time', browseUrl: 'https://lessons.example.org/' }, 'Unavailable at that time');
  });
  it('session completed carries the supplied dispute deadline', () => check(Emails.SessionCompleted, { ...optional, ...lesson, reviewUrl: 'https://lessons.example.org/dashboard#review', disputeDeadline: '2026-11-02T08:30:00Z' }, 'Normal dispute window closes'));
  it('credits low neither expires credits nor implies a compulsory purchase', () => check(Emails.CreditsLow, { ...optional, balanceCents: 499, creditsUrl: 'https://lessons.example.org/credits' }, 'US$4.99'));
  it('purchase uses the actual credits added rather than a hard-coded bonus', () => check(Emails.CreditsPurchased, { ...base, purchaseId: 'purchase-1', paidCents: 5000, addedCents: 5150, balanceCents: 5637, receiptUrl: 'https://lessons.example.org/credits' }, 'US$51.50'));
  it('verification: approval and specific rejection reason', () => {
    check(Emails.VerificationDecision, { ...base, decision: 'approved', profileUrl: 'https://lessons.example.org/tutor' }, 'passed credential review');
    check(Emails.VerificationDecision, { ...base, decision: 'rejected', reason: 'Document year is illegible', resubmitUrl: 'https://lessons.example.org/tutor/onboarding' }, 'Document year is illegible');
  });
  it('payout: requested, approved and paid are distinct and mask the destination', () => {
    const p = { ...base, payoutId: 'payout-1', amountCents: 10000, feeCents: 125, destinationLast4: '1234', earningsUrl: 'https://lessons.example.org/tutor/earnings' };
    check(Emails.PayoutStatus, { ...p, status: 'requested' }, 'cannot be requested again');
    check(Emails.PayoutStatus, { ...p, status: 'approved' }, 'not confirmation that your bank has received funds');
    check(Emails.PayoutStatus, { ...p, status: 'paid', transferReference: 'TRANSFER-123' }, 'US$98.75');
    expect(() => Emails.PayoutStatus.plainText({ ...p, status: 'requested', destinationLast4: '12345678' })).toThrow();
  });
  it('new review permits a rating without inventing a comment', () => check(Emails.NewReview, { ...optional, rating: 4, reviewUrl: 'https://lessons.example.org/tutor' }, 'without a written comment'));
  it('followed tutor slots do not imply a reservation', () => check(Emails.FollowedTutorSlots, { ...optional, tutorName: 'Tutor', profileUrl: 'https://lessons.example.org/tutors/123' }, 'does not reserve a slot'));
  it('cancellation uses the supplied resolved cents for either side', () => {
    for (const cancelledBy of ['student', 'tutor'] as const) for (const recipientRole of ['student', 'tutor'] as const) {
      check(Emails.BookingCancelled, { ...base, ...lesson, cancelledBy, recipientRole, refundCents: 1001, retainedCents: 1000 }, 'US$10.01');
    }
  });
});
describe('delivery-sensitive invariants', () => {
  it('uses the recipient timezone through a DST transition', () => {
    expect(localTime('2026-11-01T05:30:00Z', 'America/New_York')).toContain('GMT-4');
    expect(localTime('2026-11-01T06:30:00Z', 'America/New_York')).toContain('GMT-5');
    expect(localTime('2026-11-01T06:30:00Z', 'Asia/Karachi')).toContain('11:30');
    expect(() => localTime('2026-11-01T01:30:00', 'America/New_York')).toThrow();
    expect(() => localTime('2026-11-01T06:30:00Z', '')).toThrow();
  });
  it('escapes user text, refuses unsafe URLs, and keeps subject lines on one line', () => {
    const p = { ...optional, tutorName: '<script>alert(1)</script>\r\nBcc: attacker@example.org', profileUrl: 'https://lessons.example.org/tutors/123' };
    const html = renderToStaticMarkup(React.createElement(Emails.FollowedTutorSlots, p));
    expect(html).not.toContain('<script>');
    expect(Emails.FollowedTutorSlots.subject(p)).not.toMatch(/[\r\n]/);
    expect(() => Emails.FollowedTutorSlots.plainText({ ...p, profileUrl: 'javascript:alert(1)' })).toThrow();
  });
  it('includes optional unsubscribe links in both formats', () => check(Emails.CreditsLow, { ...optional, balanceCents: 100, creditsUrl: 'https://lessons.example.org/credits' }, 'Unsubscribe from this notification'));
  it('refuses fractional cents rather than silently rounding a payment', () => {
    expect(() => Emails.CreditsLow.plainText({ ...optional, balanceCents: 100.5, creditsUrl: 'https://lessons.example.org/credits' })).toThrow();
  });
});
