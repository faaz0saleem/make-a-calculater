/**
 * The development transport (SPEC.md §11).
 *
 * Records instead of sending, deduplicates on the idempotency key the way a
 * real provider does, and can be told to fail — because the interesting
 * question is never "does a send work", it is "what happens when it does not".
 */

import type { EmailProvider, EmailSendResult, OutboundEmail } from './types';

export type RecordedEmail = OutboundEmail & { sentAt: Date; providerMessageId: string };

export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';

  private readonly byKey = new Map<string, RecordedEmail>();
  private readonly order: RecordedEmail[] = [];

  /** Set to make the next sends fail. `retryable` decides which branch is tested. */
  failWith: { retryable: boolean; error: string } | null = null;

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    if (this.failWith) {
      return { ok: false, retryable: this.failWith.retryable, error: this.failWith.error };
    }

    const existing = this.byKey.get(email.idempotencyKey);
    if (existing) return { ok: true, providerMessageId: existing.providerMessageId };

    const recorded: RecordedEmail = {
      ...email,
      sentAt: new Date(),
      providerMessageId: `mock_${this.byKey.size + 1}`,
    };

    this.byKey.set(email.idempotencyKey, recorded);
    this.order.push(recorded);

    return { ok: true, providerMessageId: recorded.providerMessageId };
  }

  sent(): readonly RecordedEmail[] {
    return this.order;
  }

  lastTo(address: string): RecordedEmail | undefined {
    return [...this.order].reverse().find((email) => email.to === address);
  }

  reset(): void {
    this.byKey.clear();
    this.order.length = 0;
    this.failWith = null;
  }
}
