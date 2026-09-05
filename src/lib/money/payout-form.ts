/**
 * Reading a payout method out of a form.
 *
 * Pure, and shared by the onboarding wizard and the earnings page, because both
 * collect the same thing and a second copy of this validation would eventually
 * disagree with the first about something that matters.
 *
 * It validates *shape*, not correctness: whether an IBAN is real is something
 * only a bank can say, and rejecting a valid-but-unusual account number is a
 * worse failure than accepting one that bounces. The database's own check
 * constraint is what makes a half-filled method unstorable.
 */

import { isPayoutWallet, type PayoutMethodKind } from './payouts';

export type PayoutMethodFormValue = {
  kind: PayoutMethodKind;
  accountTitle: string;
  country: string;
  accountNumber: string;
  bankName: string | null;
  walletProvider: string | null;
  swift: string | null;
  branchCode: string | null;
  cnic: string | null;
};

export type PayoutMethodFormResult =
  | { ok: true; value: PayoutMethodFormValue }
  | { ok: false; reason: string };

type FormLike = { get(name: string): FormDataEntryValue | null };

function text(form: FormLike, name: string, max: number): string {
  return String(form.get(name) ?? '')
    .trim()
    .slice(0, max);
}

function optional(form: FormLike, name: string, max: number): string | null {
  return text(form, name, max) || null;
}

export function readPayoutMethodForm(form: FormLike): PayoutMethodFormResult {
  const kind: PayoutMethodKind = text(form, 'kind', 32) === 'mobile_wallet' ? 'mobile_wallet' : 'bank';

  const accountTitle = text(form, 'accountTitle', 200);
  const country = text(form, 'country', 2).toUpperCase();
  const accountNumber = text(form, 'accountNumber', 64);

  if (accountTitle.length < 2) return { ok: false, reason: 'Give the name on the account.' };
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, reason: 'Give a two-letter country code.' };

  // Six is short enough to admit a local account number and long enough to
  // refuse a typo. The bank decides the rest.
  const digits = accountNumber.replace(/\D/g, '');
  if (digits.length < 6) {
    return {
      ok: false,
      reason:
        kind === 'bank'
          ? 'Give your IBAN or account number.'
          : 'Give the mobile number the wallet is registered to.',
    };
  }

  if (kind === 'bank') {
    const bankName = text(form, 'bankName', 200);
    if (bankName.length < 2) return { ok: false, reason: 'Give the name of your bank.' };

    return {
      ok: true,
      value: {
        kind,
        accountTitle,
        country,
        accountNumber,
        bankName,
        walletProvider: null,
        swift: optional(form, 'swift', 32),
        branchCode: optional(form, 'branchCode', 32),
        cnic: optional(form, 'cnic', 32),
      },
    };
  }

  const walletProvider = text(form, 'walletProvider', 32);
  if (!isPayoutWallet(walletProvider)) {
    return { ok: false, reason: 'Choose JazzCash or Easypaisa.' };
  }

  return {
    ok: true,
    value: {
      kind,
      accountTitle,
      country,
      accountNumber,
      bankName: null,
      walletProvider,
      swift: null,
      branchCode: null,
      cnic: optional(form, 'cnic', 32),
    },
  };
}
