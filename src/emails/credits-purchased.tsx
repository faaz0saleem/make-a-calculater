import { defineEmail } from './_shared/email';
import { creditValue, usd } from './_shared/format';
import type { EmailBaseProps } from './_shared/types';
export type CreditsPurchasedProps = EmailBaseProps & { purchaseId: string; paidCents: number; addedCents: number; balanceCents: number; receiptUrl: string };
const CreditsPurchased = defineEmail<CreditsPurchasedProps>('CreditsPurchased', (p) => ({
  subject: 'Your lesson credits have been added', preheader: 'Your payment was confirmed and your wallet was credited.', heading: 'Your credits are ready',
  paragraphs: ['Your purchase is complete. The confirmed payment and credits added are listed below.', 'Credits never expire. Under the standard policy, purchases are non-refundable to cash and approved lesson refunds return as credits. Mandatory legal refund rights are unaffected.'],
  details: [['Purchase reference', p.purchaseId], ['Payment confirmed', usd(p.paidCents)], ['Credits added', creditValue(p.addedCents)], ['Wallet balance', creditValue(p.balanceCents)]],
  action: { label: 'View the purchase', href: p.receiptUrl },
}));
export const plainText = CreditsPurchased.plainText;
export const subject = CreditsPurchased.subject;
export default CreditsPurchased;
