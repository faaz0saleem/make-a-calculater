/**
 * Choosing a payment provider (SPEC.md §14).
 *
 * There are two questions here and they have different answers.
 *
 * *Which providers exist* is `./catalogue.ts` — a table, so adding one is a
 * config change rather than a code change. Nothing in the app branches on a
 * provider name.
 *
 * *Which one this purchase goes through* is the student's choice, defaulted
 * from their country. A Karachi student is offered JazzCash first because most
 * of them have no card at all; a London student is offered the card. Both see
 * everything.
 *
 * Every implementation today is a mock, because there is no merchant account
 * yet (DECISIONS_NEEDED.md item 1). The routing around them is not.
 */

import { findMethod, PAYMENT_METHODS } from './catalogue';
import type { PaymentProvider } from './types';

export * from './types';
export * from './catalogue';
export { MockPaymentProvider, MOCK_SIGNATURE_HEADER } from './mock';
export { MobileWalletProvider, WALLET_SIGNATURE_HEADER } from './wallet';

const cache = new Map<string, PaymentProvider>();

/**
 * The provider for an id, or the deployment's default when none is given.
 *
 * An unknown id is an error rather than a silent fall back to the default: a
 * checkout that quietly changes which provider it went through would make
 * `credit_purchases.provider` a lie, and that column is what support and the
 * revenue report both read.
 */
export function getPaymentProvider(id?: string | null): PaymentProvider {
  const wanted = (id ?? process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();

  const cached = cache.get(wanted);
  if (cached) return cached;

  const method = findMethod(wanted);
  if (!method) {
    throw new Error(
      `No payment provider called "${wanted}". Known providers: ` +
        `${PAYMENT_METHODS.map((entry) => entry.id).join(', ')}. ` +
        'Add one to src/lib/payments/catalogue.ts — see DECISIONS_NEEDED.md item 1.',
    );
  }

  const provider = method.create();
  cache.set(wanted, provider);
  return provider;
}

/** Only for tests. */
export function resetPaymentProvider(): void {
  cache.clear();
}
