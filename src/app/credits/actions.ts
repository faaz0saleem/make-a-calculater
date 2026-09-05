'use server';

/**
 * Buying credits.
 *
 * `beginCheckout` writes a pending purchase and sends the browser to the
 * provider the student chose. Every provider is a mock today, and each of them
 * is a page inside this app that posts the same signed webhook a real one
 * would — through the same route, with the same idempotency key — so
 * development exercises the production path rather than a shortcut around it.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { startPurchase } from '@/db/purchases';
import { requireUser } from '@/lib/auth/guards';
import { findMethod, getPaymentProvider, MOCK_SIGNATURE_HEADER } from '@/lib/payments';

const START_FAILURES: Record<string, string> = {
  no_such_pack: 'That pack is not on sale.',
  no_such_user: 'That account could not be found.',
  not_a_first_purchase:
    'The first-lesson pack is a one-off. Pick any of the others — they are better value anyway.',
};

export async function beginCheckout(formData: FormData): Promise<void> {
  const user = await requireUser();
  const packId = String(formData.get('packId') ?? '');
  const providerId = String(formData.get('provider') ?? '') || null;
  const returnTo = String(formData.get('returnTo') ?? '/dashboard');

  // A provider id arriving from a form is not trusted to be one we have.
  if (providerId && !findMethod(providerId)) {
    redirect(`/credits?error=${encodeURIComponent('That way of paying is not available.')}`);
  }

  const result = await startPurchase({ userId: user.id, packId, providerId, returnUrl: returnTo });

  if (!result.ok) {
    const message = START_FAILURES[result.reason] ?? 'That purchase could not be started.';
    redirect(`/credits?error=${encodeURIComponent(message)}`);
  }

  redirect(`${result.checkoutUrl}&returnTo=${encodeURIComponent(returnTo)}`);
}

/**
 * What a development provider does when somebody presses "pay".
 *
 * It delivers a signed webhook to our own endpoint over HTTP — the real path,
 * including the signature check — rather than calling the handler directly.
 * The signing happens here, on the server; the browser never sees the secret.
 *
 * It signs with the provider the purchase actually went through and posts to
 * that provider's own endpoint, because a body signed by one provider's key
 * must not verify at another's.
 */
export async function payDevelopmentCheckout(formData: FormData): Promise<void> {
  await requireUser();
  const purchaseId = String(formData.get('purchaseId') ?? '');
  const paidCents = Number(formData.get('paidCents') ?? 0);
  const providerId = String(formData.get('provider') ?? 'mock');
  const returnTo = String(formData.get('returnTo') ?? '/dashboard');
  const deliveries = Math.min(Math.max(Number(formData.get('deliveries') ?? 1), 1), 5);

  const method = findMethod(providerId);
  if (!method) {
    redirect('/credits?error=' + encodeURIComponent('That way of paying is not available.'));
  }

  const provider = getPaymentProvider(providerId) as { sign?: (body: string) => string };
  if (typeof provider.sign !== 'function') {
    redirect('/credits?error=' + encodeURIComponent('This deployment uses a real payment provider.'));
  }

  const body = JSON.stringify({
    kind: 'paid',
    purchaseId,
    paidCents,
    providerRef: `${providerId}_${purchaseId.slice(0, 8)}`,
    eventId: `evt_${purchaseId}`,
  });

  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const protocol = headerList.get('x-forwarded-proto') ?? 'http';

  for (let attempt = 0; attempt < deliveries; attempt += 1) {
    await fetch(`${protocol}://${host}/api/payments/webhook/${providerId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MOCK_SIGNATURE_HEADER]: provider.sign(body),
      },
      body,
    });
  }

  revalidatePath('/dashboard');
  revalidatePath('/credits');
  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}credited=1`);
}
