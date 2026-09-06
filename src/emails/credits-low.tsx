import { defineEmail } from './_shared/email';
import { creditValue } from './_shared/format';
import type { OptionalEmailProps } from './_shared/types';
export type CreditsLowProps = OptionalEmailProps & { balanceCents: number; creditsUrl: string };
const CreditsLow = defineEmail<CreditsLowProps>('CreditsLow', (p) => ({
  subject: 'Your lesson-credit balance', preheader: 'Check your balance when planning your next lesson.', heading: 'Plan your next booking',
  paragraphs: ['Your credit balance is below the reminder level set by the platform. Check the price of your next lesson before deciding whether to top up.', 'There is no need to rush: credits never expire. Purchases are non-refundable to cash under the standard policy, and approved lesson refunds return as credits. Ask your guardian before spending if you are under 18.'],
  details: [['Current balance', creditValue(p.balanceCents)]], action: { label: 'View your credits', href: p.creditsUrl },
}));
export const plainText = CreditsLow.plainText;
export const subject = CreditsLow.subject;
export default CreditsLow;
