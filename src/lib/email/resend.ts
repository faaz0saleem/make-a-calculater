/**
 * Resend, over its HTTP API (SPEC.md §11).
 *
 * `fetch` rather than the SDK: the request is one POST with a bearer token, and
 * a dependency whose whole job is to build that object is a dependency to keep
 * patched, audit and eventually remove. Swapping to another vendor means one
 * more file next to this one.
 *
 * The classification below is the part that matters. A 422 for a malformed
 * address is a message that will never send, and retrying it four more times
 * only delays the moment somebody notices. A 429 or a 503 is the provider
 * asking us to come back later, which is exactly what the queue is for.
 */

import type { EmailProvider, EmailSendResult, OutboundEmail } from './types';

const ENDPOINT = 'https://api.resend.com/emails';

export type ResendConfig = {
  apiKey: string;
  /** `Tutorly <hello@example.com>`. Must be a domain verified with Resend. */
  from: string;
  replyTo?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(private readonly config: ResendConfig) {}

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const doFetch = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000);

    try {
      const response = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          // Resend honours this, so a retry after a timeout we never saw the
          // answer to does not send the same reminder twice.
          'Idempotency-Key': email.idempotencyKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          from: this.config.from,
          to: [email.to],
          ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.headers ? { headers: email.headers } : {}),
          ...(email.attachments
            ? {
                attachments: email.attachments.map((attachment) => ({
                  filename: attachment.filename,
                  content: attachment.contentBase64,
                  content_type: attachment.contentType,
                })),
              }
            : {}),
        }),
      });

      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { id?: string };
        return { ok: true, providerMessageId: body.id ?? 'unknown' };
      }

      const detail = (await response.text().catch(() => '')).slice(0, 500);

      return {
        ok: false,
        // 408 and 429 are "later"; every other 4xx is "never".
        retryable: response.status >= 500 || response.status === 429 || response.status === 408,
        error: `resend ${response.status}: ${detail}`,
      };
    } catch (error) {
      // A timeout or a DNS failure is the network, not the message.
      return {
        ok: false,
        retryable: true,
        error: `resend transport: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
