/**
 * Which transport a reminder goes out through (SPEC.md §11).
 *
 * One place decides, the same way `lib/payments/catalogue.ts` decides which
 * rail a payment takes. Adding a real WhatsApp client means adding an entry
 * here and nothing else.
 */

import { MockOutboundProvider } from './mock';
import type { OutboundProvider } from './types';

export * from './types';
export { MockOutboundProvider } from './mock';

let override: OutboundProvider | null = null;
const fallback = new MockOutboundProvider();

/**
 * The provider in use.
 *
 * A mock until a real one is configured — and the mock is a deliberate choice
 * rather than a gap: everything except the last HTTP call is real, so the day a
 * Business API key arrives, the routing, the dedupe and the failure handling
 * have already been running in production against nobody.
 */
export function getOutboundProvider(): OutboundProvider {
  return override ?? fallback;
}

/** For tests, and for a deployment that wires a real client at boot. */
export function setOutboundProvider(provider: OutboundProvider | null): void {
  override = provider;
}

/** The mock's record of what it was asked to send. Empty in production. */
export function sentMessages(): ReadonlyArray<{ to: string; body: string; idempotencyKey: string }> {
  return fallback.sent;
}
