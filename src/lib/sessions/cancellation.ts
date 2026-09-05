/**
 * Saying what a cancellation would cost, before it happens.
 *
 * Every money-moving action states its consequence first. The thresholds come
 * from `src/lib/money/outcomes.ts` — the same constants settlement uses — so
 * this text cannot drift from what actually happens to someone's credits.
 */

import { formatCents } from '@/lib/money/cents';
import { FULL_REFUND_CUTOFF_MINUTES, PARTIAL_REFUND_CUTOFF_MINUTES } from '@/lib/money/outcomes';

export type CancellableBooking = {
  startAtUtc: Date;
  isTrial: boolean;
  priceCents: number;
};

export function cancellationConsequence(booking: CancellableBooking, now: Date): string {
  if (booking.isTrial) return 'Cancelling a free trial costs nothing.';

  const minutes = Math.floor((booking.startAtUtc.getTime() - now.getTime()) / 60_000);

  if (minutes > FULL_REFUND_CUTOFF_MINUTES) {
    return `Cancelling now returns all ${formatCents(booking.priceCents)} to your balance.`;
  }
  if (minutes >= PARTIAL_REFUND_CUTOFF_MINUTES) {
    return (
      `This starts in under 24 hours, so cancelling now returns half — ` +
      `${formatCents(Math.round(booking.priceCents / 2))} of ${formatCents(booking.priceCents)}.`
    );
  }
  return `This starts in under 2 hours, so cancelling now refunds nothing — you would lose all ${formatCents(booking.priceCents)}.`;
}
