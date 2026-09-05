/**
 * Buying credits, wherever that happens.
 *
 * One component, because top-up is now two places: the credits page, and inline
 * in the booking flow at the moment somebody has chosen a tutor and a time and
 * is short. Those must not drift apart — the second is where most purchases
 * will actually happen, and it is the one nobody would remember to update.
 *
 * One form, one method radio group, and a submit button per pack. That keeps
 * the chosen method attached to whichever pack is pressed without JavaScript,
 * and without repeating the radios five times.
 *
 * Local methods lead. In Pakistan that means JazzCash and Easypaisa above the
 * card, because a card-only checkout is not an expensive checkout for most
 * students there — it is a closed door.
 */

import { beginCheckout } from '@/app/credits/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money/cents';
import { packBonusBps, type CreditPack } from '@/lib/money/packs';
import type { PaymentMethodDescriptor } from '@/lib/payments/catalogue';

export function TopUp({
  packs,
  methods,
  returnTo,
  /** When set, the cheapest pack that clears it is called out. */
  shortfallCents,
}: {
  packs: CreditPack[];
  methods: PaymentMethodDescriptor[];
  returnTo: string;
  shortfallCents?: number;
}) {
  const suggested =
    typeof shortfallCents === 'number'
      ? [...packs].sort((a, b) => a.creditsCents - b.creditsCents).find(
          (pack) => pack.creditsCents >= shortfallCents,
        )
      : undefined;

  return (
    <form action={beginCheckout} className="flex flex-col gap-5">
      <input type="hidden" name="returnTo" value={returnTo} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">How would you like to pay?</legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {methods.map((method, index) => (
            <label
              key={method.id}
              className="flex flex-1 items-start gap-2 rounded-md border border-border px-3 py-2 text-sm"
              data-testid="payment-method"
              data-method={method.id}
            >
              <input
                type="radio"
                name="provider"
                value={method.id}
                defaultChecked={index === 0}
                className="mt-1 size-4"
              />
              <span>
                <span className="font-medium">{method.label}</span>
                <span className="block text-xs text-muted-foreground">{method.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {packs.map((pack) => {
          const bonus = packBonusBps(pack);
          const isSuggested = suggested?.id === pack.id;

          return (
            <div
              key={pack.id}
              className={`flex h-full flex-col gap-2 rounded-lg border p-3 ${
                isSuggested ? 'border-[var(--success)]' : 'border-border'
              }`}
              data-testid="credit-pack"
              data-pack={pack.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{pack.name}</span>
                {bonus > 0 ? <Badge variant="success">+{(bonus / 100).toFixed(0)}%</Badge> : null}
                {pack.firstPurchaseOnly ? <Badge variant="outline">One per person</Badge> : null}
                {isSuggested ? <Badge variant="secondary">Covers this lesson</Badge> : null}
              </div>

              <p className="text-sm text-muted-foreground">
                {formatCents(pack.creditsCents)} of credits for {formatCents(pack.paidCents)}
              </p>

              {/* Pushed to the bottom so a card with two badges lines up with
                  one that has none. */}
              <Button
                type="submit"
                name="packId"
                value={pack.id}
                variant={isSuggested ? 'default' : 'outline'}
                className="mt-auto min-h-11 w-full"
                data-testid={`buy-${pack.id}`}
              >
                Buy {pack.name}
              </Button>
            </div>
          );
        })}
      </div>
    </form>
  );
}
