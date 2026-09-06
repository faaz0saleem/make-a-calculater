/**
 * The email transport, behind an interface (SPEC.md §11, §13.6).
 *
 * The same shape as `PaymentProvider` and `OutboundProvider`, for the same
 * reason: the sender is a vendor decision, and a vendor decision that has grown
 * into every call site is a vendor decision you cannot reverse. Resend is what
 * we start with; nothing above this file knows that.
 */

export type EmailAttachment = {
  filename: string;
  contentType: string;
  /** Base64. Small things only — a calendar invite, not a video. */
  contentBase64: string;
};

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * The same key twice is the same email once. Providers retry, our own worker
   * retries, and a person clicking twice is a person clicking twice.
   */
  idempotencyKey: string;
  /** `List-Unsubscribe` and friends. */
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
};

/**
 * `retryable` is the whole point of this type.
 *
 * A refused recipient and a provider outage are both failures, and treating
 * them the same means either giving up on a message that would have gone
 * through, or retrying a bad address until a dead-letter table fills with it.
 */
export type EmailSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; error: string };

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<EmailSendResult>;
}
