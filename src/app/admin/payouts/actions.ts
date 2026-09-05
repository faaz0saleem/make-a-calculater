'use server';

/**
 * Deciding a payout (SPEC.md §2, §10).
 *
 * Four verbs, one underlying function. Each writes an `admin_audit` row inside
 * the same transaction that moves the money, and none of them can see the
 * account number — approving a transfer does not require reading the account
 * it goes to, and a screen that could read it is a screen that could leak it.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { decidePayout, type PayoutDecision } from '@/db/payouts';
import { requestIp } from '@/lib/admin/audit';
import { requireRole } from '@/lib/auth/guards';

/** A bank reference a tutor will search for. Kept loose: rails differ. */
const REFERENCE_MAX = 64;

function back(message: string, kind: 'error' | 'done'): never {
  redirect(`/admin/payouts?${kind}=${encodeURIComponent(message)}`);
}

export async function decidePayoutAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const payoutId = String(formData.get('payoutId') ?? '');
  const to = String(formData.get('to') ?? '');
  const reference = String(formData.get('reference') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!payoutId) back('That payout could not be found.', 'error');

  let decision: PayoutDecision;
  switch (to) {
    case 'approved':
      decision = { to: 'approved' };
      break;
    case 'processing':
      decision = { to: 'processing' };
      break;
    case 'paid':
      // Without a reference the tutor has nothing to match against their bank
      // statement, which is the whole point of recording one.
      if (!reference) back('A payment reference is required — the tutor sees it.', 'error');
      decision = { to: 'paid', reference: reference.slice(0, REFERENCE_MAX) };
      break;
    case 'rejected':
      // The tutor reads this. "No" without a reason is a support ticket.
      if (!reason) back('A rejection needs a reason. The tutor sees it.', 'error');
      decision = { to: 'rejected', reason: reason.slice(0, 500) };
      break;
    default:
      back('Unknown decision.', 'error');
  }

  const result = await decidePayout(payoutId, { id: admin.id, ip: await requestIp() }, decision);

  revalidatePath('/admin/payouts');
  revalidatePath('/admin');

  if (!result.ok) back(result.reason, 'error');
  back(result.status, 'done');
}
