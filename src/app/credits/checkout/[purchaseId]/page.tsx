/**
 * The mock provider's payment page.
 *
 * A real provider would host this. It exists so that development and the tests
 * take the same route production will: pressing the button posts a signed
 * webhook to `/api/payments/webhook`, and the credits arrive the same way they
 * would from Paddle.
 *
 * The "deliver it three times" control is not a toy. Providers really do
 * redeliver, and being able to reproduce that in one click is how the
 * idempotency stays proven rather than assumed.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { payMockCheckout } from '@/app/credits/actions';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loadPurchaseFor } from '@/db/purchases';
import { requireUser } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout' };

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ purchaseId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const [{ purchaseId }, query, user] = await Promise.all([params, searchParams, requireUser()]);

  const purchase = await loadPurchaseFor(purchaseId, user.id);
  if (!purchase) notFound();

  const returnTo = query.returnTo ?? '/dashboard';

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-12 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle as="h1">Confirm your purchase</CardTitle>
            <CardDescription>
              {formatCents(purchase.paidCents)} for {formatCents(purchase.creditsCents)} of credits.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <p className="rounded-md bg-secondary px-3 py-2 text-sm">
              This is the development payment provider. <strong>No card is taken and no money moves.</strong>{' '}
              Pressing the button delivers the same signed webhook a real provider would.
            </p>

            {purchase.status === 'paid' ? (
              <p role="status" className="text-sm">
                This purchase has already been credited. Delivering the webhook again changes nothing —
                which is the point.
              </p>
            ) : null}

            <form action={payMockCheckout} className="flex flex-col gap-3">
              <input type="hidden" name="purchaseId" value={purchase.id} />
              <input type="hidden" name="paidCents" value={purchase.paidCents} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="deliveries" value="1" />
              <Button type="submit" size="lg" className="min-h-11" data-testid="pay-now">
                Pay {formatCents(purchase.paidCents)}
              </Button>
            </form>

            <form action={payMockCheckout}>
              <input type="hidden" name="purchaseId" value={purchase.id} />
              <input type="hidden" name="paidCents" value={purchase.paidCents} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="deliveries" value="3" />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="min-h-11"
                data-testid="pay-thrice"
              >
                Pay, and deliver the webhook three times
              </Button>
            </form>

            <Link href="/credits" className="text-sm text-muted-foreground underline underline-offset-4">
              Cancel
            </Link>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
