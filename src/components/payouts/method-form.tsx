'use client';

/**
 * Where a tutor is paid.
 *
 * Two shapes, and the choice between them is the first control rather than a
 * footnote. In this market a mobile wallet is not a lesser option — for a great
 * many tutors JazzCash or Easypaisa is the only account they have, and a
 * bank-only form means they cannot be paid at all.
 *
 * The form only ever *writes* the numbers. Once saved nothing reads them back:
 * the tutor sees the last four digits, and so does an admin. That is not a UI
 * decision that could drift — `PayoutMethodView` has no field that could carry
 * an account number.
 */

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Select } from '@/components/ui/select';
import { formatCents } from '@/lib/money/cents';
import { PAYOUT_THRESHOLD_CENTS, PAYOUT_WALLETS, type PayoutMethodKind } from '@/lib/money/payouts';

export type SavedMethod = {
  kind: PayoutMethodKind;
  accountTitle: string;
  bankName: string | null;
  walletProvider: string | null;
  country: string;
  last4: string;
};

export function PayoutMethodForm({
  action,
  method,
  country,
  submitLabel = 'Save',
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  method: SavedMethod | null;
  country: string | null;
  submitLabel?: string;
  children?: React.ReactNode;
}) {
  const [kind, setKind] = useState<PayoutMethodKind>(method?.kind ?? 'bank');
  const inPakistan = (country ?? method?.country ?? '').toUpperCase() === 'PK';

  return (
    <form action={action} className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        You will need this before your first payout at {formatCents(PAYOUT_THRESHOLD_CENTS)}. Everything
        you type here is <strong className="text-foreground">encrypted before it is stored</strong> — not
        just by the disk, by us. Afterwards nobody sees more than the last four digits, including our own
        admins.
      </p>

      {method ? (
        <div
          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
          data-testid="payout-method-on-file"
        >
          <div>
            <p className="font-medium">{method.accountTitle}</p>
            <p className="text-muted-foreground">
              {method.kind === 'bank'
                ? method.bankName
                : (PAYOUT_WALLETS.find((wallet) => wallet.id === method.walletProvider)?.label ??
                  method.walletProvider)}{' '}
              · {method.country} · ····{method.last4}
            </p>
          </div>
          <Badge variant="secondary">On file</Badge>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">How would you like to be paid?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { value: 'bank', label: 'Bank account', blurb: 'IBAN, or an account and branch code.' },
              {
                value: 'mobile_wallet',
                label: 'Mobile wallet',
                blurb: 'JazzCash or Easypaisa, paid to your number.',
              },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                kind === option.value ? 'border-primary' : 'border-border'
              }`}
              data-testid={`payout-kind-${option.value}`}
            >
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="mt-1 size-4"
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Account title"
          htmlFor="accountTitle"
          hint={kind === 'bank' ? 'Exactly as your bank has it.' : 'The name registered on the wallet.'}
        >
          <Input
            id="accountTitle"
            name="accountTitle"
            defaultValue={method?.accountTitle ?? ''}
            required
            maxLength={200}
          />
        </Field>

        <Field label="Country" htmlFor="country" hint="Two-letter code.">
          <Input
            id="country"
            name="country"
            defaultValue={method?.country ?? country ?? ''}
            required
            minLength={2}
            maxLength={2}
            className="uppercase"
          />
        </Field>
      </div>

      {kind === 'bank' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank name" htmlFor="bankName">
              <Input
                id="bankName"
                name="bankName"
                defaultValue={method?.bankName ?? ''}
                required
                maxLength={200}
              />
            </Field>
            <Field label="IBAN or account number" htmlFor="accountNumber">
              <Input
                id="accountNumber"
                name="accountNumber"
                required
                minLength={6}
                maxLength={64}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="SWIFT / BIC"
              htmlFor="swift"
              hint="For international transfers. Leave blank for a local account."
            >
              <Input id="swift" name="swift" maxLength={32} autoComplete="off" />
            </Field>
            <Field
              label="Branch code"
              htmlFor="branchCode"
              hint={
                inPakistan
                  ? 'Pakistani banks are addressed by branch code rather than SWIFT.'
                  : 'If your bank uses one.'
              }
            >
              <Input id="branchCode" name="branchCode" maxLength={32} autoComplete="off" />
            </Field>
          </div>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Wallet" htmlFor="walletProvider">
            <Select
              id="walletProvider"
              name="walletProvider"
              defaultValue={method?.walletProvider ?? 'jazzcash'}
              required
            >
              {PAYOUT_WALLETS.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Mobile number"
            htmlFor="accountNumber"
            hint="The number the wallet is registered to."
          >
            <Input
              id="accountNumber"
              name="accountNumber"
              type="tel"
              inputMode="tel"
              required
              minLength={6}
              maxLength={32}
              autoComplete="off"
              placeholder="+92 300 1234567"
            />
          </Field>
        </div>
      )}

      <Field label="CNIC" htmlFor="cnic" hint="Optional, Pakistan-domiciled tutors only.">
        <Input id="cnic" name="cnic" maxLength={32} autoComplete="off" />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{submitLabel}</Button>
        {children}
      </div>
    </form>
  );
}
