'use server';

/**
 * A tutor asking to be paid, and telling us where.
 *
 * Both resolve the tutor from the session. Nothing here takes an id from a
 * form, because a form that could name whose money to move is a form somebody
 * will eventually edit.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requestPayout, savePayoutMethod } from '@/db/payouts';
import { requireRole } from '@/lib/auth/guards';
import { readPayoutMethodForm } from '@/lib/money/payout-form';

const HERE = '/tutor/earnings';

function back(message: string): never {
  redirect(`${HERE}?error=${encodeURIComponent(message)}`);
}

export async function savePayoutAccount(formData: FormData): Promise<void> {
  const user = await requireRole('tutor');

  const parsed = readPayoutMethodForm(formData);
  if (!parsed.ok) back(parsed.reason);

  await savePayoutMethod(user.id, parsed.value);

  revalidatePath(HERE);
  redirect(`${HERE}?saved=method`);
}

export async function askForPayout(formData: FormData): Promise<void> {
  const user = await requireRole('tutor');

  const dollars = Number(formData.get('amount') ?? 0);
  const amountCents = Math.round(dollars * 100);

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    back('Give an amount to withdraw.');
  }

  // The balance check, the row and the ledger entries all happen inside one
  // transaction in `requestPayout`, so two tabs cannot both spend the same
  // available balance.
  const result = await requestPayout(user.id, amountCents);
  if (!result.ok) back(result.reason);

  revalidatePath(HERE);
  revalidatePath('/tutor');
  redirect(`${HERE}?requested=${result.payoutId}`);
}
