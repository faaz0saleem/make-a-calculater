'use server';

/**
 * Buying credits.
 *
 * `beginCheckout` writes a pending purchase and sends the browser to the
 * provider. With the mock provider that is a page inside this app, which posts
 * the same signed webhook a real provider would — through the same route, with
 * the same idempotency key — so development exercises the production path
 * rather than a shortcut around it.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { startPurchase } from '@/db/purchases';
import { requireUser } from '@/lib/auth/guards';
import { MOCK_SIGNATURE_HEADER, MockPaymentProvider, getPaymentProvider } from '@/lib/payments';

export async function beginCheckout(formData: FormData): Promise<void> {
  const user = await requireUser();
  const packId = String(formData.get('packId') ?? '');
  const returnTo = String(formData.get('returnTo') ?? '/dashboard');

  const result = await startPurchase({ userId: user.id, packId, returnUrl: returnTo });

  if (!result.ok) {
    redirect(`/credits?error=${encodeURIComponent('That pack is not on sale.')}`);
  }

  redirect(`${result.checkoutUrl}&returnTo=${encodeURIComponent(returnTo)}`);
}

/**
 * What the mock provider does when somebody presses "pay".
 *
 * It delivers a signed webhook to our own endpoint over HTTP — the real path,
 * including the signature check — rather than calling the handler directly.
 * The signing happens here, on the server; the browser never sees the secret.
 */
export async function payMockCheckout(formData: FormData): Promise<void> {
  const user = await requireUser();
  const purchaseId = String(formData.get('purchaseId') ?? '');
  const paidCents = Number(formData.get('paidCents') ?? 0);
  const returnTo = String(formData.get('returnTo') ?? '/dashboard');
  const deliveries = Math.min(Math.max(Number(formData.get('deliveries') ?? 1), 1), 5);

  const provider = getPaymentProvider();
  if (!(provider instanceof MockPaymentProvider)) {
    redirect('/credits?error=' + encodeURIComponent('This deployment uses a real payment provider.'));
  }

  const body = JSON.stringify({
    kind: 'paid',
    purchaseId,
    paidCents,
    providerRef: `mock_${purchaseId.slice(0, 8)}`,
    eventId: `evt_${purchaseId}`,
  });

  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const protocol = headerList.get('x-forwarded-proto') ?? 'http';

  for (let attempt = 0; attempt < deliveries; attempt += 1) {
    await fetch(`${protocol}://${host}/api/payments/webhook`, {
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
