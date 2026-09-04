/**
 * Choosing a payment provider (SPEC.md §14).
 *
 * `PAYMENT_PROVIDER=mock` is the only value that resolves today. When a real
 * merchant of record is chosen, it lands here as another `case` and nothing
 * else in the codebase changes — that is the point of the interface.
 */

import { MockPaymentProvider } from './mock';
import type { PaymentProvider } from './types';

export * from './types';
export { MockPaymentProvider, MOCK_SIGNATURE_HEADER } from './mock';

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  const configured = (process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();

  switch (configured) {
    case 'mock':
      cached = new MockPaymentProvider();
      return cached;
    default:
      // Not a silent fallback: a deployment that names a provider we have not
      // built should fail loudly at the first purchase, not quietly credit
      // wallets through a mock.
      throw new Error(
        `PAYMENT_PROVIDER is "${configured}", and no such provider is implemented. ` +
          'Only "mock" exists today — see DECISIONS_NEEDED.md item 1.',
      );
  }
}

/** Only for tests. */
export function resetPaymentProvider(): void {
  cached = null;
}
