/**
 * What a tutor has earned, and getting it out.
 *
 * The per-session table is read from the ledger rather than recomputed, which
 * matters more than it sounds. Commission has been 15%, 16%, 20% and 22% at
 * different times, and a tutor scrolling their history will see all four. If
 * the page recalculated each row at today's rate it would quietly rewrite what
 * they were actually paid; instead each row carries the rate it was booked at,
 * printed beside it, so the mixture reads as history rather than as a bug.
 */

import Link from 'next/link';

import { askForPayout, savePayoutAccount } from '@/app/tutor/earnings/actions';
import { PayoutMethodForm } from '@/components/payouts/method-form';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardMetric, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/db/client';
import {
  earningsFor,
  earningsSummaryFor,
  payoutHistoryFor,
  payoutMethodFor,
} from '@/db/payouts';
import { users } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { payoutGate } from '@/lib/auth/verification';
import { TERMINAL_BOOKING_STATUSES } from '@/lib/bookings/status';
import { formatCents } from '@/lib/money/cents';
import {
  canRequestPayout,
  PAYOUT_STATUS_BLURBS,
  PAYOUT_STATUS_LABELS,
  PAYOUT_THRESHOLD_CENTS,
  type PayoutStatus,
} from '@/lib/money/payouts';
import { formatInTimeZone } from '@/lib/time';
import { cn } from '@/lib/utils';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Earnings' };

/** How a rate is described to the tutor whose money it was. */
function rateLabel(commissionBps: number): string {
  return `${(commissionBps / 100).toFixed(0)}%`;
}

/**
 * What a session that has not settled yet is worth.
 *
 * A booking still to come has moved no money, so the ledger correctly says
 * zero — but printing "$0.00 you received" next to next Friday's lesson reads
 * as "this one paid you nothing", which is the opposite of true. Settled rows
 * still come from the ledger; only the ones that have not happened yet are
 * computed, at their own snapshotted rate, and labelled as expectations.
 */
function expectedSplit(priceCents: number, commissionBps: number) {
  const platformCents = Math.floor((priceCents * commissionBps) / 10_000);
  return { platformCents, tutorCents: priceCents - platformCents };
}

export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; requested?: string }>;
}) {
  const user = await requireRole('tutor');
  const query = await searchParams;

  const [summary, sessions, method, payouts, profile] = await Promise.all([
    earningsSummaryFor(user.id),
    earningsFor(user.id),
    payoutMethodFor(user.id),
    payoutHistoryFor(user.id),
    db
      .select({ country: users.country, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1),
  ]);

  const eligibility = canRequestPayout(summary.availableCents, summary.availableCents);
  // Checked here as well as in `requestPayout`, so a tutor who cannot be paid
  // yet reads why before filling in an amount rather than after (SPEC.md §1).
  const verified = payoutGate(profile[0]?.emailVerified != null);
  const openPayout = payouts.find((payout) => payout.status !== 'paid' && payout.status !== 'rejected');

  // The rates actually present in this tutor's history, so the note explaining
  // the mixture only appears when there is a mixture.
  const rates = [...new Set(sessions.map((session) => session.commissionBps))].sort((a, b) => a - b);
  const unsettled = sessions.filter(
    (session) => !(TERMINAL_BOOKING_STATUSES as readonly string[]).includes(session.status),
  ).length;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Earnings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Money moves from pending to available once a session is past its dispute window.
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {query.saved === 'method' ? (
          <p role="status" className="rounded-md bg-[var(--success)]/10 px-4 py-3 text-sm">
            Saved. We only kept the last four digits where anyone can see them.
          </p>
        ) : null}

        {query.requested ? (
          <p role="status" className="rounded-md bg-[var(--success)]/10 px-4 py-3 text-sm">
            Requested. That amount is already set aside — it cannot be spent or requested twice.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['Available', summary.availableCents, 'Yours to withdraw now.'],
              ['Pending', summary.pendingCents, 'Sessions still inside their dispute window.'],
              ['Locked for payout', summary.lockedCents, 'Requested and on its way out.'],
              ['Earned all time', summary.lifetimeCents, 'Everything ever credited to you.'],
            ] as const
          ).map(([label, cents, blurb]) => (
            <Card key={label}>
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardMetric className="text-3xl" data-testid={`earnings-${label.split(' ')[0]!.toLowerCase()}`}>
                  {formatCents(cents)}
                </CardMetric>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{blurb}</CardContent>
            </Card>
          ))}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* Requesting                                                     */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Withdraw</CardTitle>
            <CardDescription>
              The threshold is {formatCents(PAYOUT_THRESHOLD_CENTS)} of available balance. Requesting
              moves the amount out of available straight away, so it cannot be spent twice while we send
              it.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {!verified.allowed ? (
              <p className="rounded-md bg-secondary px-3 py-2 text-sm" data-testid="payout-unverified">
                {verified.reason}{' '}
                <Link href="/settings/email" className="underline underline-offset-4">
                  Send yourself the link
                </Link>
                .
              </p>
            ) : null}

            {!method ? (
              <p className="rounded-md bg-secondary px-3 py-2 text-sm">
                Add the account you want to be paid into first — the form is below.
              </p>
            ) : null}

            {openPayout ? (
              <p className="rounded-md bg-secondary px-3 py-2 text-sm" data-testid="open-payout">
                <strong>{formatCents(openPayout.amountCents)}</strong> is already{' '}
                {PAYOUT_STATUS_LABELS[openPayout.status].toLowerCase()}.{' '}
                {PAYOUT_STATUS_BLURBS[openPayout.status]}
              </p>
            ) : null}

            {eligibility.ok ? (
              <form action={askForPayout} className="flex flex-wrap items-end gap-3">
                <div className="flex min-w-40 flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor="amount">
                    Amount, in dollars
                  </label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    min={PAYOUT_THRESHOLD_CENTS / 100}
                    max={summary.availableCents / 100}
                    step="0.01"
                    defaultValue={(summary.availableCents / 100).toFixed(2)}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={!method || !verified.allowed}
                  data-testid="request-payout"
                >
                  Request {formatCents(summary.availableCents)}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="payout-blocked">
                {eligibility.reason}
              </p>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* Session history                                                */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Every session</CardTitle>
            <CardDescription>
              What each one paid, at the rate it was booked at.
              {unsettled > 0
                ? ` ${unsettled} ${unsettled === 1 ? 'has' : 'have'} not settled yet — those show what to expect.`
                : null}
              {rates.length > 1 ? (
                <>
                  {' '}
                  You will see {rates.map(rateLabel).join(', ')} here. That is not an error — commission
                  has changed over time, and{' '}
                  <strong>a session always keeps the rate it was booked at</strong>.
                </>
              ) : null}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing yet. Sessions appear here once the money has moved.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-140 text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Student</th>
                      <th className="py-2 pr-3 text-right font-medium">Price</th>
                      <th className="py-2 pr-3 text-right font-medium">Commission</th>
                      <th className="py-2 text-right font-medium">You received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => {
                      const done = (TERMINAL_BOOKING_STATUSES as readonly string[]).includes(
                        session.status,
                      );
                      const amounts = done
                        ? { platformCents: session.platformCents, tutorCents: session.tutorCents }
                        : expectedSplit(session.priceCents, session.commissionBps);

                      return (
                      <tr
                        key={session.bookingId}
                        className="border-b border-border last:border-0"
                        data-testid="earning-row"
                        data-rate={session.commissionBps}
                        data-settled={done ? 'yes' : 'no'}
                      >
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {formatInTimeZone(session.startAtUtc, user.timezone, { dateStyle: 'medium' })}
                        </td>
                        <td className="py-2 pr-3">
                          {session.studentName}
                          {session.status !== 'settled' ? (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              {session.status.replace(/_/g, ' ')}
                            </Badge>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatCents(session.priceCents)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <span className="text-muted-foreground">
                            {formatCents(amounts.platformCents)}
                          </span>{' '}
                          <Badge variant="outline" className="text-[10px]">
                            {rateLabel(session.commissionBps)}
                          </Badge>
                        </td>
                        <td
                          className={cn(
                            'py-2 text-right font-medium tabular-nums',
                            done ? '' : 'text-muted-foreground',
                          )}
                        >
                          {formatCents(amounts.tutorCents)}
                          {done ? null : (
                            <span className="block text-[10px] font-normal">expected</span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* Payout history                                                 */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Withdrawals</CardTitle>
          </CardHeader>
          <CardContent>
            {payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {payouts.map((payout) => (
                  <li key={payout.id} className="flex flex-col gap-1 py-3" data-testid="payout-row">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium tabular-nums">{formatCents(payout.amountCents)}</span>
                      <span className="flex items-center gap-2">
                        {payout.last4 ? (
                          <span className="text-xs text-muted-foreground">····{payout.last4}</span>
                        ) : null}
                        <Badge
                          variant={
                            payout.status === 'paid'
                              ? 'success'
                              : payout.status === 'rejected'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {PAYOUT_STATUS_LABELS[payout.status as PayoutStatus]}
                        </Badge>
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Requested {formatInTimeZone(payout.requestedAt, user.timezone, { dateStyle: 'medium' })}
                      . {PAYOUT_STATUS_BLURBS[payout.status as PayoutStatus]}
                    </p>

                    {payout.paidRef ? (
                      <p className="text-xs" data-testid="payout-reference">
                        Reference <code className="font-mono">{payout.paidRef}</code> — this is what your
                        bank or wallet will show.
                      </p>
                    ) : null}

                    {payout.rejectReason ? (
                      <p className="text-xs text-[var(--destructive)]" data-testid="payout-reject-reason">
                        {payout.rejectReason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* Where the money goes                                           */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Where we send it</CardTitle>
          </CardHeader>
          <CardContent>
            <PayoutMethodForm
              action={savePayoutAccount}
              method={method}
              country={profile[0]?.country ?? null}
              submitLabel={method ? 'Replace this account' : 'Save this account'}
            />
          </CardContent>
        </Card>

        <Link href="/tutor" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to teaching
        </Link>
      </main>
    </>
  );
}
