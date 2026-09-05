/**
 * The development payment provider.
 *
 * It does not pretend to take money. It sends the browser to a page inside the
 * app that says as much, and that page posts the same signed webhook a real
 * provider would — through the same route, with the same idempotency key — so
 * the path money takes in production is the path that is exercised in
 * development and in the tests.
 *
 * The signature is a real HMAC over the body with `AUTH_SECRET`. That is not
 * security theatre: it means `parseWebhook` has the same shape as a real
 * provider's, and the webhook route can refuse an unsigned body in every
 * environment rather than only in production.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  WebhookResult,
} from './types';

export const MOCK_SIGNATURE_HEADER = 'x-tutorly-signature';

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private readonly secret: string;

  constructor(secret = process.env.AUTH_SECRET ?? 'development-secret') {
    this.secret = secret;
  }

  isConfigured(): boolean {
    return true;
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const providerRef = `mock_${request.purchaseId.slice(0, 8)}`;
    const url = `/credits/checkout/${request.purchaseId}?ref=${providerRef}`;
    return { url, providerRef };
  }

  /** The signature a caller must produce. Exported for the checkout page. */
  sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }

  async parseWebhook(body: string, headers: Headers): Promise<WebhookResult> {
    const provided = headers.get(MOCK_SIGNATURE_HEADER) ?? '';
    const expected = this.sign(body);

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_signature' };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    if (typeof payload !== 'object' || payload === null) return { ok: false, reason: 'malformed' };

    const event = payload as Record<string, unknown>;
    const kind = event.kind;
    const purchaseId = event.purchaseId;
    const paidCents = event.paidCents;
    const providerRef = event.providerRef;
    const eventId = event.eventId;

    if (kind !== 'paid' && kind !== 'failed' && kind !== 'refunded') {
      return { ok: false, reason: 'unknown_event' };
    }
    if (typeof purchaseId !== 'string' || typeof paidCents !== 'number') {
      return { ok: false, reason: 'malformed' };
    }

    return {
      ok: true,
      event: {
        kind,
        purchaseId,
        paidCents,
        providerRef: typeof providerRef === 'string' ? providerRef : `mock_${purchaseId.slice(0, 8)}`,
        // The provider's event id when there is one. A real provider always
        // sends one; keying off the purchase and the kind is the fallback, and
        // is still enough to make a redelivery a no-op.
        idempotencyKey: typeof eventId === 'string' ? eventId : `${purchaseId}:${kind}`,
      },
    };
  }
}
