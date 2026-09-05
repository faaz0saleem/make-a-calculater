/**
 * The payment provider boundary (SPEC.md §14).
 *
 * Stripe will not serve a Pakistan-domiciled business, and which
 * merchant-of-record we end up with is an account decision with weeks of lead
 * time (DECISIONS_NEEDED.md item 1). So nothing in this codebase names a
 * provider. Everything goes through this interface, and today the only
 * implementation is a mock that settles instantly in development.
 *
 * The shape is deliberately the small intersection of what Paddle, Lemon
 * Squeezy and 2Checkout all do: create a checkout, receive a signed webhook,
 * and be told the same thing more than once.
 */

export type CheckoutRequest = {
  /** Our own id for the purchase. Comes back on the webhook. */
  purchaseId: string;
  userId: string;
  email: string;
  packId: string;
  /** What the student pays, in cents. */
  paidCents: number;
  /** What lands in the wallet, in cents. */
  creditsCents: number;
  /** Where to send the browser afterwards. */
  returnUrl: string;
};

export type CheckoutSession = {
  /** Where to send the browser to pay. */
  url: string;
  /** The provider's own id for this attempt, stored for support. */
  providerRef: string;
};

/**
 * What a provider's webhook boils down to, once the signature has been checked.
 *
 * `idempotencyKey` is the provider's event id where they give us one, and a
 * deterministic key derived from the purchase where they do not. Either way it
 * carries a unique index, which is what makes a third delivery a no-op.
 */
export type PaymentEvent = {
  kind: 'paid' | 'failed' | 'refunded';
  purchaseId: string;
  providerRef: string;
  paidCents: number;
  idempotencyKey: string;
};

export type WebhookResult =
  | { ok: true; event: PaymentEvent }
  | { ok: false; reason: 'bad_signature' | 'unknown_event' | 'malformed' };

export interface PaymentProvider {
  /** Stored on `credit_purchases.provider`, and never branched on in logic. */
  readonly name: string;

  /** Whether this deployment can actually take money. */
  isConfigured(): boolean;

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;

  /**
   * Verify and parse a webhook. Given the raw body and headers, because every
   * provider signs the bytes rather than the parsed object.
   */
  parseWebhook(body: string, headers: Headers): Promise<WebhookResult>;
}

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}
