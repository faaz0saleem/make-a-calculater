/**
 * Which ways of paying exist, and who is offered which.
 *
 * One table. Adding a provider — a real merchant of record, a third wallet, a
 * bank transfer for a market we have not launched in — is an entry here and
 * nothing else: no branch in the checkout, no `if (country === 'PK')` anywhere
 * in the app, no change to `startPurchase`.
 *
 * `countries` decides **order, not availability**. A student in Karachi sees
 * JazzCash and Easypaisa first because that is what they have; a student in
 * London sees the card first. Both still see everything, because somebody's
 * billing address and their means of payment are not the same thing.
 *
 * The fee figures are not used to charge anybody. They are here because the
 * choice between these providers is a margin decision and the numbers behind it
 * belong next to the choice — and because the admin dashboard needs them to
 * report net revenue rather than gross.
 */

import { MockPaymentProvider } from './mock';
import { MobileWalletProvider } from './wallet';
import type { PaymentProvider } from './types';

export type PaymentMethodDescriptor = {
  /** Stored on `credit_purchases.provider`. Never branched on in logic. */
  id: string;
  /** What a student sees on the button. */
  label: string;
  /** One line under it. */
  blurb: string;
  /**
   * Countries where this is a normal way to pay, most relevant first. Empty
   * means "everywhere", which is what a card is.
   */
  countries: readonly string[];
  /** What the provider takes, for margin reporting. Not charged to anybody. */
  feeBps: number;
  fixedFeeCents: number;
  create: () => PaymentProvider;
};

export const PAYMENT_METHODS: readonly PaymentMethodDescriptor[] = [
  {
    id: 'mock',
    label: 'Card',
    blurb: 'Visa, Mastercard or a debit card.',
    countries: [],
    // Paddle's shape: 5% + 50c. The fixed half is what makes a $5 purchase
    // expensive and is the whole reason the wallets below exist.
    feeBps: 500,
    fixedFeeCents: 50,
    create: () => new MockPaymentProvider(),
  },
  {
    id: 'jazzcash',
    label: 'JazzCash',
    blurb: 'Pay from your JazzCash mobile wallet.',
    countries: ['PK'],
    feeBps: 200,
    fixedFeeCents: 0,
    create: () => new MobileWalletProvider('jazzcash'),
  },
  {
    id: 'easypaisa',
    label: 'Easypaisa',
    blurb: 'Pay from your Easypaisa mobile wallet.',
    countries: ['PK'],
    feeBps: 250,
    fixedFeeCents: 0,
    create: () => new MobileWalletProvider('easypaisa'),
  },
];

export function findMethod(id: string): PaymentMethodDescriptor | undefined {
  return PAYMENT_METHODS.find((method) => method.id === id);
}

/**
 * The methods to offer somebody in this country, best first.
 *
 * Local methods lead, everything else follows in table order. Nothing is
 * removed: a Pakistani student with a card can still use it, and a British
 * student who happens to have a JazzCash wallet can still use that.
 */
export function methodsForCountry(country: string | null | undefined): PaymentMethodDescriptor[] {
  const code = country?.toUpperCase() ?? '';

  return [...PAYMENT_METHODS].sort((a, b) => {
    const aLocal = a.countries.includes(code);
    const bLocal = b.countries.includes(code);
    if (aLocal !== bLocal) return aLocal ? -1 : 1;
    return PAYMENT_METHODS.indexOf(a) - PAYMENT_METHODS.indexOf(b);
  });
}

/** The one a checkout defaults to for this country. */
export function defaultMethodFor(country: string | null | undefined): PaymentMethodDescriptor {
  return methodsForCountry(country)[0]!;
}

/**
 * What a purchase through this method costs us, in cents.
 *
 * The reason the $5 pack is a first purchase only, in one function: 75c through
 * a card, 10c through a wallet.
 */
export function providerFeeCents(method: PaymentMethodDescriptor, paidCents: number): number {
  return Math.round((paidCents * method.feeBps) / 10_000) + method.fixedFeeCents;
}
