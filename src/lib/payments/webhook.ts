/**
 * Handling a provider's webhook, once, for every provider.
 *
 * Each provider gets its own endpoint — `/api/payments/webhook/jazzcash` and so
 * on — because that is how providers are configured in the real world, and
 * because a body has to be verified with the signing key of the provider that
 * signed it. Guessing which one sent it, or trying each in turn, would make the
 * signature check meaningless.
 *
 * The logic itself is one function, so adding a provider adds a route file and
 * no behaviour.
 */

import { applyPaymentEvent } from '@/db/purchases';
import { getPaymentProvider } from './index';

export async function handlePaymentWebhook(
  request: Request,
  providerId?: string,
): Promise<Response> {
  let provider;
  try {
    provider = getPaymentProvider(providerId);
  } catch {
    // An unknown provider in the path is a 404, not a 400: the endpoint does
    // not exist, and saying anything else describes our configuration to
    // whoever is probing.
    return new Response('Not found', { status: 404 });
  }

  // The raw bytes: every provider signs what was sent, not what we re-encode.
  const body = await request.text();
  const parsed = await provider.parseWebhook(body, request.headers);

  if (!parsed.ok) {
    // A bad signature is a 401 and nothing else — no hint about whether the
    // purchase in the body exists.
    const status = parsed.reason === 'bad_signature' ? 401 : 400;
    return Response.json({ ok: false, reason: parsed.reason }, { status });
  }

  try {
    const result = await applyPaymentEvent(parsed.event);

    // 200 either way: a provider that gets a 500 for a duplicate will keep
    // sending it, which is the opposite of what we want.
    return Response.json({ ok: true, applied: result.applied, reason: result.reason });
  } catch (error) {
    console.error('payment webhook failed', error);
    return Response.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
