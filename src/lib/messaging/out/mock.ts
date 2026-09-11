/**
 * The development transport (SPEC.md §11).
 *
 * Records what would have been sent and returns a reference, so every path
 * downstream — the dedupe key, the failure branch, the log line — is exercised
 * without a WhatsApp account existing.
 *
 * `failFor` is not decoration: a real number goes dead, a provider rate-limits,
 * and the reminder job has to keep going rather than stop on the first
 * unreachable person. That branch needs a way to be tested.
 */

import type { OutboundMessage, OutboundProvider, OutboundResult } from './types';

export type SentMessage = OutboundMessage & { at: Date; channel: string };

export class MockOutboundProvider implements OutboundProvider {
  readonly id = 'mock';
  readonly channel = 'whatsapp' as const;

  /** Everything this provider was asked to send, newest last. */
  readonly sent: SentMessage[] = [];

  constructor(private readonly failFor: (message: OutboundMessage) => string | null = () => null) {}

  isReady(): boolean {
    return true;
  }

  async send(message: OutboundMessage): Promise<OutboundResult> {
    const failure = this.failFor(message);
    if (failure) return { ok: false, reason: failure, retryable: true };

    // Same key twice is the same message. A provider would collapse these; so
    // does this, so the dedupe logic is exercised rather than assumed.
    const already = this.sent.find((entry) => entry.idempotencyKey === message.idempotencyKey);
    if (already) {
      return { ok: true, providerRef: `mock_${message.idempotencyKey}`, channel: this.channel };
    }

    this.sent.push({ ...message, at: new Date(), channel: this.channel });
    return { ok: true, providerRef: `mock_${message.idempotencyKey}`, channel: this.channel };
  }
}
