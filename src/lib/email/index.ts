/**
 * Which transport is in use, decided once (SPEC.md §11).
 *
 * Resend when it is configured, the mock otherwise. There is no third branch
 * and no silent production default: an unconfigured production deployment
 * queues mail and sends nothing, which the admin alerts view shows as a growing
 * queue rather than as silence — see `EMAIL_FROM` in LAUNCH.md.
 */

import { MockEmailProvider } from './mock';
import { ResendEmailProvider } from './resend';
import type { EmailProvider } from './types';

let override: EmailProvider | null = null;
let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (override) return override;
  if (cached) return cached;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  cached =
    apiKey && from
      ? new ResendEmailProvider({ apiKey, from, replyTo: process.env.EMAIL_REPLY_TO })
      : new MockEmailProvider();

  return cached;
}

/** Tests and the seed. */
export function setEmailProvider(provider: EmailProvider | null): void {
  override = provider;
  cached = null;
}

/** True when real mail would go out. The health check and LAUNCH.md read this. */
export function emailIsConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export { MockEmailProvider } from './mock';
export { ResendEmailProvider } from './resend';
export type { EmailProvider, EmailSendResult, OutboundEmail } from './types';
