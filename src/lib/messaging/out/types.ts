/**
 * Sending a message to somebody off the platform (SPEC.md §11).
 *
 * The same shape as `lib/payments`: an interface, a catalogue, and a mock that
 * records rather than sends. Nothing in the product knows the name of a
 * provider — WhatsApp today, an SMS gateway in a market where WhatsApp is not
 * the default, both at once for people who have given a number and not opted
 * into one of them.
 *
 * The routing is real even though the transport is a mock. That is the half
 * that is hard to retrofit: which channel a person gets, whether a number is
 * usable, what happens when a send fails, and the dedupe key that stops a
 * retrying cron sending the same reminder four times. Swapping the mock for a
 * Business API client is a file; discovering afterwards that nothing ever
 * decided who to send to is a rewrite.
 */

export type OutboundChannel = 'whatsapp' | 'sms';

export type OutboundMessage = {
  /** E.164, as stored on `users.phone`. */
  to: string;
  body: string;
  /** Stops a retry sending twice. Providers call this a client reference. */
  idempotencyKey: string;
};

export type OutboundResult =
  | { ok: true; providerRef: string; channel: OutboundChannel }
  | { ok: false; reason: string; retryable: boolean };

export interface OutboundProvider {
  readonly id: string;
  readonly channel: OutboundChannel;
  /** Whether this provider is configured well enough to be tried at all. */
  isReady(): boolean;
  send(message: OutboundMessage): Promise<OutboundResult>;
}

/**
 * A number we could plausibly reach.
 *
 * Deliberately loose: this rejects obvious rubbish and nothing else, because a
 * validator that is stricter than the world drops real people. The provider is
 * the thing that actually knows.
 */
export function isReachableNumber(value: string | null | undefined): value is string {
  if (!value) return false;
  const digits = value.replace(/[^\d]/g, '');
  return digits.length >= 8 && digits.length <= 15;
}
