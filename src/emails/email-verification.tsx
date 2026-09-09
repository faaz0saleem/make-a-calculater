import { defineEmail } from './_shared/email';
import { usd } from './_shared/format';
import type { EmailBaseProps } from './_shared/types';

export type EmailVerificationProps = EmailBaseProps & {
  verifyUrl: string;
  expiresInHours: number;
  /** The purchase size above which confirming is required, in cents. */
  purchaseThresholdCents: number;
};

/**
 * Confirming an address, without pretending it is a gate.
 *
 * Everything on Tutorly works before this is done — browsing, booking, taking
 * a lesson. It says so, because an email that implies your account is locked
 * when it is not teaches people to distrust the next one. What it does say is
 * exactly where the line is, so the moment somebody hits it is not a surprise.
 */
const EmailVerification = defineEmail<EmailVerificationProps>('EmailVerification', (p) => ({
  subject: 'Confirm your email address',
  preheader: 'One tap. Everything else already works.',
  heading: 'Confirm this is you',
  paragraphs: [
    `Tap below to confirm this address. The link expires in ${p.expiresInHours} hours and you can ask for another at any time.`,
    'You do not need this to browse, book a lesson or teach one — all of that works already.',
    `It is required before money moves: a tutor's first payout, and any credit purchase over ${usd(
      p.purchaseThresholdCents,
    )}. That is the point where a receipt going to the wrong inbox actually costs somebody something.`,
  ],
  action: { label: 'Confirm my email', href: p.verifyUrl },
}));

export const plainText = EmailVerification.plainText;
export const subject = EmailVerification.subject;
export default EmailVerification;
