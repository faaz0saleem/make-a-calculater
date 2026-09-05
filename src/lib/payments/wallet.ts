/**
 * Pakistani mobile wallets: JazzCash and Easypaisa.
 *
 * Two reasons these exist, and the second matters more than the first.
 *
 * The first is cost. A merchant-of-record charging 5% + 50c turns a $5 purchase
 * into 75c of fees — fifteen percent, on the transaction we most want somebody
 * to make. The wallets charge roughly 1.5-2.5% with no meaningful fixed fee, so
 * the same purchase costs about 10c.
 *
 * The second is that **many students here have no card at all**. A card-only
 * checkout is not an expensive checkout for them, it is a closed door.
 *
 * This is a mock, like the card provider, because there is no merchant account
 * yet. What is *not* a mock is the routing around it: which provider a student
 * is offered is decided by their country in `./catalogue.ts`, and swapping this
 * class for a real integration changes nothing outside this file.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { CheckoutRequest, CheckoutSession, PaymentProvider, WebhookResult } from './types';

export const WALLET_SIGNATURE_HEADER = 'x-tutorly-signature';

export class MobileWalletProvider implements PaymentProvider {
  readonly name: string;

  private readonly secret: string;

  constructor(name: string, secret = process.env.AUTH_SECRET ?? 'development-secret') {
    this.name = name;
    this.secret = secret;
  }

  isConfigured(): boolean {
    // A real one would check for merchant credentials. This one is honest that
    // it cannot take money, which is why nothing reads it as "ready to launch".
    return true;
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const providerRef = `${this.name}_${request.purchaseId.slice(0, 8)}`;
    // The same development checkout page as the card provider, told which
    // method it is standing in for so it can say so.
    const url = `/credits/checkout/${request.purchaseId}?ref=${providerRef}&via=${this.name}`;
    return { url, providerRef };
  }

  sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }

  async parseWebhook(body: string, headers: Headers): Promise<WebhookResult> {
    const provided = headers.get(WALLET_SIGNATURE_HEADER) ?? '';
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
    const { kind, purchaseId, paidCents, providerRef, eventId } = event;

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
        providerRef:
          typeof providerRef === 'string' ? providerRef : `${this.name}_${purchaseId.slice(0, 8)}`,
        idempotencyKey: typeof eventId === 'string' ? eventId : `${purchaseId}:${kind}`,
      },
    };
  }
}
