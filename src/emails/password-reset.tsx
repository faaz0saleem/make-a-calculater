import { defineEmail } from './_shared/email';
import type { EmailBaseProps } from './_shared/types';

export type PasswordResetProps = EmailBaseProps & {
  resetUrl: string;
  /** Minutes the link is good for, so the copy cannot drift from the code. */
  expiresInMinutes: number;
  /** Where the request came from. Not proof of anything — context. */
  requestedFrom?: string | null;
};

/**
 * The one email nobody reads carefully and everybody needs to work.
 *
 * It says three things and nothing else: here is the link, it dies in half an
 * hour, and if this was not you then nothing has happened yet. That last
 * sentence matters more than it looks — a reset email is also the notification
 * that somebody is trying to take your account.
 */
const PasswordReset = defineEmail<PasswordResetProps>('PasswordReset', (p) => ({
  subject: 'Reset your Tutorly password',
  preheader: 'A link to set a new password. It expires shortly.',
  heading: 'Set a new password',
  paragraphs: [
    `Use the button below to choose a new password. The link works once and expires in ${p.expiresInMinutes} minutes.`,
    'If you did not ask for this, you can ignore it — your password has not changed and nobody has been let in. Somebody may have typed your address by mistake.',
    'Setting a new password signs you out everywhere else, including on any device you no longer have.',
  ],
  details: p.requestedFrom ? [['Requested from', p.requestedFrom]] : undefined,
  action: { label: 'Choose a new password', href: p.resetUrl },
}));

export const plainText = PasswordReset.plainText;
export const subject = PasswordReset.subject;
export default PasswordReset;
