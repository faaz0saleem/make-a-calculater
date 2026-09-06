import { beforeAll, describe, expect, it, vi } from 'vitest';

import { EMAIL_KINDS, isOptionalEmail } from './kinds';
import { renderEmail, type EmailPayload } from './render';
import { resetEnvCache } from '../env';

const ORIGIN = 'https://tutorly.example';
const RECIPIENT = { userId: '11111111-2222-3333-4444-555555555555', name: 'Ayesha' };

const LESSON = {
  bookingId: '99999999-8888-7777-6666-555555555555',
  counterpartName: 'Usman Bhatti',
  subjectName: 'Chemistry',
  startsAt: '2026-09-12T14:00:00Z',
  timezone: 'Asia/Karachi',
  durationMinutes: 60,
  bookingUrl: `${ORIGIN}/sessions/99999999-8888-7777-6666-555555555555`,
};

/** One plausible payload per kind, so the whole set is exercised. */
const PAYLOADS: EmailPayload[] = [
  {
    kind: 'booking_confirmed',
    data: { ...LESSON, recipientRole: 'student', isTrial: false, priceCents: 3_000 },
  },
  {
    kind: 'booking_cancelled',
    data: {
      ...LESSON,
      cancelledBy: 'tutor',
      recipientRole: 'student',
      refundCents: 3_000,
      retainedCents: 0,
    },
  },
  { kind: 'reminder_24h', data: LESSON },
  { kind: 'reminder_1h', data: LESSON },
  { kind: 'session_starting', data: { ...LESSON, classroomUrl: `${ORIGIN}/sessions/x` } },
  {
    kind: 'session_completed',
    data: { ...LESSON, reviewUrl: `${ORIGIN}/review/x`, disputeDeadline: '2026-09-13T14:00:00Z' },
  },
  { kind: 'trial_requested', data: { ...LESSON, expiresAt: '2026-09-08T14:00:00Z' } },
  { kind: 'trial_decision', data: { ...LESSON, decision: 'accepted' } },
  {
    kind: 'credits_purchased',
    data: {
      purchaseId: 'pur_1',
      paidCents: 2_500,
      addedCents: 2_750,
      balanceCents: 5_000,
      receiptUrl: `${ORIGIN}/credits`,
    },
  },
  { kind: 'credits_low', data: { balanceCents: 500, creditsUrl: `${ORIGIN}/credits` } },
  {
    kind: 'verification_decision',
    data: { decision: 'approved', profileUrl: `${ORIGIN}/tutors/x` },
  },
  {
    kind: 'payout_status',
    data: {
      status: 'paid',
      payoutId: 'po_1',
      amountCents: 10_000,
      feeCents: 0,
      destinationLast4: '4242',
      transferReference: 'EP-1',
      earningsUrl: `${ORIGIN}/tutor/earnings`,
    },
  },
  {
    kind: 'new_review',
    data: { rating: 5, reviewText: 'Very clear.', reviewUrl: `${ORIGIN}/tutors/x` },
  },
  {
    kind: 'followed_tutor_slots',
    data: { tutorName: 'Usman Bhatti', profileUrl: `${ORIGIN}/tutors/x` },
  },
];

describe('rendering every email', () => {
  beforeAll(() => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-that-is-long-enough');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('PAYOUT_ENCRYPTION_KEY', Buffer.alloc(32).toString('base64'));
    resetEnvCache();
  });

  it('covers all fourteen kinds', () => {
    // A kind added without a payload here means a template nothing can send.
    expect(PAYLOADS.map((payload) => payload.kind).sort()).toEqual([...EMAIL_KINDS].sort());
  });

  it.each(PAYLOADS.map((payload) => [payload.kind, payload] as const))(
    'renders %s as a document and as text',
    async (kind, payload) => {
      const rendered = await renderEmail(payload, RECIPIENT, ORIGIN);

      expect(rendered.subject.length).toBeGreaterThan(0);
      // A subject with a newline in it is a header-injection bug.
      expect(rendered.subject).not.toMatch(/[\r\n]/);

      expect(rendered.html.startsWith('<!doctype html>')).toBe(true);
      expect(rendered.html).toContain('Ayesha');
      // Every message says who it is from and how to get help.
      expect(rendered.html).toContain(`${ORIGIN}/privacy`);

      // The text half is not a courtesy: a mail client that cannot render HTML,
      // or a person who has turned it off, gets this and nothing else.
      expect(rendered.text).toContain('Tutorly');
      expect(rendered.text.length).toBeGreaterThan(120);

      expect(kind).toBeTruthy();
    },
  );

  it('puts an unsubscribe link on optional mail and none on operational mail', async () => {
    for (const payload of PAYLOADS) {
      const rendered = await renderEmail(payload, RECIPIENT, ORIGIN);

      if (isOptionalEmail(payload.kind)) {
        expect(rendered.unsubscribeUrl, payload.kind).toContain(`${ORIGIN}/unsubscribe/`);
        expect(rendered.html, payload.kind).toContain('/unsubscribe/');
        expect(rendered.html, payload.kind).toContain('/settings/email');
      } else {
        // Not an oversight: you cannot unsubscribe from being told your payout
        // was sent, so offering the link would be a promise we would break.
        expect(rendered.unsubscribeUrl, payload.kind).toBeNull();
        expect(rendered.html, payload.kind).not.toContain('/unsubscribe/');
      }
    }
  });

  it('gives each kind its own unsubscribe link', async () => {
    // One link for everything would make somebody choose between "stop telling
    // me a tutor I follow opened time" and "stop telling me my lesson starts".
    const reminder = (await renderEmail(PAYLOADS[2]!, RECIPIENT, ORIGIN)).unsubscribeUrl;
    const follows = (await renderEmail(PAYLOADS[13]!, RECIPIENT, ORIGIN)).unsubscribeUrl;

    expect(reminder).not.toEqual(follows);
  });

  it('shows the time in the recipient timezone, not the server one', async () => {
    const karachi = (await renderEmail(PAYLOADS[2]!, RECIPIENT, ORIGIN)).text;
    const newYork = (
      await renderEmail(
        { kind: 'reminder_24h', data: { ...LESSON, timezone: 'America/New_York' } },
        RECIPIENT,
        ORIGIN,
      )
    ).text;

    expect(karachi).toContain('Asia/Karachi');
    expect(karachi).toContain('19:00');
    expect(newYork).toContain('America/New_York');
    expect(newYork).toContain('10:00');
  });
});
