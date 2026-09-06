/**
 * The fourteen things this product sends email about (SPEC.md §11).
 *
 * One enum, matched by the fourteen templates in `src/emails`. Deliberately not
 * the same list as `notification_kind`: the bell and the inbox answer different
 * questions. The bell says "something happened while you were away"; email has
 * to be worth interrupting somebody's day for, so a message arriving is a bell
 * event and never an email.
 */

export const EMAIL_KINDS = [
  'booking_confirmed',
  'booking_cancelled',
  'reminder_24h',
  'reminder_1h',
  'session_starting',
  'session_completed',
  'trial_requested',
  'trial_decision',
  'credits_purchased',
  'credits_low',
  'verification_decision',
  'payout_status',
  'new_review',
  'followed_tutor_slots',
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

/**
 * Which of them a person may switch off.
 *
 * The line is not "important" versus "unimportant" — it is whether the message
 * is part of a transaction the recipient is already in. You cannot unsubscribe
 * from being told your payout was sent, that your credential review was
 * rejected, or that a session you paid for was cancelled: those are records of
 * something that happened to your money or your account, and hiding them behind
 * a preference is how somebody finds out three weeks late.
 *
 * Everything convenience-shaped is optional, reminders included. A person who
 * turns those off has decided their calendar is enough, which is a decision
 * they are allowed to make — the in-app bell and WhatsApp still fire.
 */
export const OPTIONAL_EMAIL_KINDS = new Set<EmailKind>([
  'reminder_24h',
  'reminder_1h',
  'session_starting',
  'session_completed',
  'credits_low',
  'new_review',
  'followed_tutor_slots',
]);

export function isOptionalEmail(kind: EmailKind): boolean {
  return OPTIONAL_EMAIL_KINDS.has(kind);
}

export function isEmailKind(value: string): value is EmailKind {
  return (EMAIL_KINDS as readonly string[]).includes(value);
}

/** What the preferences screen calls each one, and why somebody would want it. */
export const EMAIL_KIND_LABELS: Record<EmailKind, { title: string; description: string }> = {
  booking_confirmed: {
    title: 'Booking confirmed',
    description: 'A receipt when a session is booked and credits are taken.',
  },
  booking_cancelled: {
    title: 'Booking cancelled',
    description: 'What was cancelled, by whom, and what came back to you.',
  },
  reminder_24h: {
    title: 'Reminder the day before',
    description: 'A nudge about tomorrow, with the time in your own timezone.',
  },
  reminder_1h: {
    title: 'Reminder an hour before',
    description: 'The last useful moment to find your notes.',
  },
  session_starting: {
    title: 'Session starting',
    description: 'The link, ten minutes before it begins.',
  },
  session_completed: {
    title: 'After a session',
    description: 'What was covered, and the chance to leave a review.',
  },
  trial_requested: {
    title: 'Trial requested',
    description: 'A student has asked you for a free trial and is waiting.',
  },
  trial_decision: {
    title: 'Trial answered',
    description: 'Whether a tutor accepted your trial request.',
  },
  credits_purchased: {
    title: 'Credits purchased',
    description: 'A receipt for a credit purchase.',
  },
  credits_low: {
    title: 'Credits running low',
    description: 'Before a standing session lapses for want of credits.',
  },
  verification_decision: {
    title: 'Verification decision',
    description: 'The outcome of your credential review.',
  },
  payout_status: {
    title: 'Payout status',
    description: 'Requested, approved, and sent.',
  },
  new_review: {
    title: 'New review',
    description: 'Somebody reviewed a session you taught.',
  },
  followed_tutor_slots: {
    title: 'A tutor you follow opened time',
    description: 'When somebody you follow publishes more hours.',
  },
};
