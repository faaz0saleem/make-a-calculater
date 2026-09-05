/**
 * Buying credits (SPEC.md §2).
 *
 * Credits are the only thing a student ever buys — sessions are paid for out of
 * the balance, never with a card. One credit is one dollar; the larger packs
 * carry a bonus, and the page says how much rather than making anybody work it
 * out.
 */

import Link from 'next/link';

import { TopUp } from '@/components/credits/top-up';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardMetric, CardTitle } from '@/components/ui/card';
import { db } from '@/db/client';
import { packsForUser, purchaseHistoryFor } from '@/db/purchases';
import { studentWallets, users } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { eq } from 'drizzle-orm';
import { formatCents } from '@/lib/money/cents';
import { findMethod, methodsForCountry } from '@/lib/payments';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Credits' };

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string; credited?: string }>;
}) {
  const [user, query] = await Promise.all([requireUser(), searchParams]);

  const [packs, history, wallet, profile] = await Promise.all([
    packsForUser(user.id),
    purchaseHistoryFor(user.id),
    db
      .select({ creditsCents: studentWallets.creditsCents })
      .from(studentWallets)
      .where(eq(studentWallets.userId, user.id))
      .limit(1),
    db.select({ country: users.country }).from(users).where(eq(users.id, user.id)).limit(1),
  ]);

  const balance = wallet[0]?.creditsCents ?? 0;
  const returnTo = query.returnTo ?? '/dashboard';
  // Which ways of paying to offer, and in what order. Everyone sees all of
  // them; the country only decides which is on top.
  const methods = methodsForCountry(profile[0]?.country);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Buy credits</h1>
          <p className="text-sm text-muted-foreground">
            One credit is $1. Credits never expire, and refunds come back as credits rather than to your
            card.
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {query.credited ? (
          <p role="status" className="rounded-md bg-[var(--success)]/10 px-4 py-3 text-sm">
            Credits added. They are in your balance now.
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription>Your balance</CardDescription>
            <CardMetric className="text-3xl" data-testid="credit-balance">
              {formatCents(balance)}
            </CardMetric>
          </CardHeader>
        </Card>

        <TopUp packs={packs} methods={methods} returnTo={returnTo} />

        <p className="text-xs text-muted-foreground">
          Every provider here is a development stand-in — nothing is charged and no money moves. The
          routing is real: {methods[0]!.label} is first because of where you are.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Your purchases</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {history.map((purchase) => (
                  <li
                    key={purchase.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
                  >
                    <span>{formatInTimeZone(purchase.createdAt, user.timezone)}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant={purchase.status === 'paid' ? 'success' : 'secondary'}>
                        {purchase.status}
                      </Badge>
                      <span className="tabular-nums">
                        {formatCents(purchase.paidCents)} → {formatCents(purchase.creditsCents)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {findMethod(purchase.provider)?.label ?? purchase.provider}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Link href={returnTo} className="text-sm text-muted-foreground underline underline-offset-4">
          Back
        </Link>
      </main>
    </>
  );
}
