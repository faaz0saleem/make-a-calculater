import { defineEmail } from './_shared/email';
import { usd } from './_shared/format';
import type { EmailBaseProps } from './_shared/types';
export type PayoutStatusProps = EmailBaseProps & { payoutId: string; amountCents: number; feeCents: number; destinationLast4: string; earningsUrl: string } & (
  { status: 'requested' | 'approved' } | { status: 'paid'; transferReference: string }
);
const PayoutStatus = defineEmail<PayoutStatusProps>('PayoutStatus', (p) => {
  if (!/^[A-Za-z0-9]{4}$/.test(p.destinationLast4)) throw new Error('Supply only the last four account characters.');
  if (p.feeCents > p.amountCents) throw new Error('Payout fee cannot exceed the requested amount.');
  const paragraphs = {
    requested: ['Your payout request was received. The requested amount is locked while it is reviewed and cannot be requested again.', 'The standard minimum is US$100 in available earnings. A request is not a completed transfer.'],
    approved: ['Your payout request has been approved. It still needs to be processed and sent; approval is not confirmation that your bank has received funds.', 'Track the status in your earnings page. Any disclosed conversion or receiving-bank charges may affect the amount received.'],
    paid: ['Your payout has been marked paid with the transfer reference below. Bank or wallet processing can still affect when the funds appear.', 'If the transfer has not arrived, use the reference when contacting support. Never email your full account number or credentials.'],
  };
  return { subject: `Payout ${p.status}: ${usd(p.amountCents)}`, preheader: 'A status update for your tutor payout.', heading: `Your payout is ${p.status}`, paragraphs: paragraphs[p.status],
    details: [['Payout reference', p.payoutId], ['Requested amount', usd(p.amountCents)], ['Platform payout fee', usd(p.feeCents)], ['Amount sent before external charges', p.status === 'paid' ? usd(p.amountCents - p.feeCents) : 'Transfer not yet confirmed'], ['Destination', `Account ending ${p.destinationLast4}`], ...(p.status === 'paid' ? [['Transfer reference', p.transferReference] as [string, string]] : [])],
    action: { label: 'Track your payout', href: p.earningsUrl },
  };
});
export const plainText = PayoutStatus.plainText;
export const subject = PayoutStatus.subject;
export default PayoutStatus;
