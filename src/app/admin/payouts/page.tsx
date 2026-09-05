/**
 * The payout queue (SPEC.md §2, §10).
 *
 * An admin here can move money out of the platform and can refuse to. What they
 * cannot do — deliberately, and enforced by the query rather than by the markup
 * — is see the account it goes to. `payoutQueue` selects `last4` and the bank
 * or wallet name and stops there; approving a transfer never needed more, and
 * the one screen most likely to grow a "just show me the number" field is this
 * one.
 *
 * Every button below states what it will do before it does it, because three of
 * the four are irreversible.
 */

import Link from 'next/link';

import { decidePayoutAction } from '@/app/admin/payouts/actions';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardMetric, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { payoutQueue, recentPayoutDecisions, type PayoutQueueRow } from '@/db/payouts';
import { requireRole } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { PAYOUT_STATUS_LABELS, PAYOUT_WALLETS, type PayoutStatus } from '@/lib/money/payouts';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payout queue' };

const DONE_COPY: Record<string, string> = {
  approved: 'Approved. It is queued for transfer and still locked.',
  processing: 'Marked as sent. Add the reference once the transfer lands.',
  paid: 'Marked paid. The tutor can see the reference on their earnings page.',
  rejected: 'Rejected. The money went back to the tutor’s available balance and they can see why.',
};

/** Where the money is going, in as much detail as anyone is allowed. */
function destination(row: PayoutQueueRow): string {
  if (!row.methodKind) return 'No account on file';

  const rail =
    row.methodKind === 'mobile_wallet'
      ? (PAYOUT_WALLETS.find((wallet) => wallet.id === row.walletProvider)?.label ??
        row.walletProvider ??
        'Mobile wallet')
      : (row.bankName ?? 'Bank');

  return `${rail} ····${row.last4 ?? '????'} · ${row.accountTitle ?? '—'} · ${row.country ?? '—'}`;
}

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const admin = await requireRole('admin');
  const query = await searchParams;

  const [queue, decided] = await Promise.all([payoutQueue(), recentPayoutDecisions(20)]);

  const owedCents = queue.reduce((total, row) => total + row.amountCents, 0);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Payout queue</h1>
          <Link href="/admin" className="text-sm text-muted-foreground underline underline-offset-4">
            Back to admin
          </Link>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {query.done ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm" data-testid="payout-decided">
            {DONE_COPY[query.done] ?? query.done}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Waiting</CardDescription>
              <CardMetric data-testid="queue-count">{queue.length}</CardMetric>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Locked against these requests</CardDescription>
              <CardMetric data-testid="queue-total">{formatCents(owedCents)}</CardMetric>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Already out of the tutors&rsquo; available balances.
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Open requests</CardTitle>
            <CardDescription>Oldest first — somebody has been waiting longest.</CardDescription>
          </CardHeader>

          <CardContent>
            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing waiting.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {queue.map((row) => (
                  <li key={row.id} className="flex flex-col gap-3 py-4" data-testid="payout-request">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-medium">{row.tutorName ?? row.tutorEmail}</p>
                        <p className="text-xs text-muted-foreground">{destination(row)}</p>
                      </div>
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {PAYOUT_STATUS_LABELS[row.status as PayoutStatus]}
                        </Badge>
                        <span className="text-lg font-medium tabular-nums" data-testid="payout-amount">
                          {formatCents(row.amountCents)}
                        </span>
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Requested {formatInTimeZone(row.requestedAt, admin.timezone)}
                    </p>

                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                      {row.status === 'requested' ? (
                        <form action={decidePayoutAction}>
                          <input type="hidden" name="payoutId" value={row.id} />
                          <input type="hidden" name="to" value="approved" />
                          <Button type="submit" size="sm" data-testid="approve-payout">
                            Approve
                          </Button>
                        </form>
                      ) : null}

                      {row.status === 'approved' ? (
                        <form action={decidePayoutAction}>
                          <input type="hidden" name="payoutId" value={row.id} />
                          <input type="hidden" name="to" value="processing" />
                          <Button type="submit" size="sm" variant="outline" data-testid="send-payout">
                            Mark as sent to the bank
                          </Button>
                        </form>
                      ) : null}

                      {row.status === 'processing' ? (
                        <form
                          action={decidePayoutAction}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="payoutId" value={row.id} />
                          <input type="hidden" name="to" value="paid" />
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium" htmlFor={`ref-${row.id}`}>
                              Bank reference
                            </label>
                            <Input
                              id={`ref-${row.id}`}
                              name="reference"
                              required
                              maxLength={64}
                              placeholder="e.g. HBL-20260904-0091"
                              className="h-9 w-56"
                            />
                          </div>
                          <Button type="submit" size="sm" data-testid="pay-payout">
                            Mark paid
                          </Button>
                        </form>
                      ) : null}
                    </div>

                    {row.status === 'processing' ? (
                      <p className="text-xs text-muted-foreground">
                        Marking paid retires {formatCents(row.amountCents)} from the platform&rsquo;s
                        books. It cannot be undone here, and the reference is shown to the tutor.
                      </p>
                    ) : null}

                    {row.status === 'approved' ? (
                      <p className="text-xs text-muted-foreground">
                        Make the transfer, then mark it as sent. The reference goes in at the last
                        step, when you know the bank actually took it.
                      </p>
                    ) : null}

                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">
                        Reject this request
                      </summary>
                      <form action={decidePayoutAction} className="mt-2 flex flex-col gap-2">
                        <input type="hidden" name="payoutId" value={row.id} />
                        <input type="hidden" name="to" value="rejected" />
                        <label className="text-xs font-medium" htmlFor={`reason-${row.id}`}>
                          Why. The tutor reads this.
                        </label>
                        <Textarea id={`reason-${row.id}`} name="reason" required rows={2} />
                        <p className="text-xs text-muted-foreground">
                          {formatCents(row.amountCents)} goes back to their available balance and they
                          can request it again.
                        </p>
                        <Button
                          type="submit"
                          size="sm"
                          variant="destructive"
                          className="self-start"
                          data-testid="reject-payout"
                        >
                          Reject and return the money
                        </Button>
                      </form>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Recently decided</CardTitle>
          </CardHeader>
          <CardContent>
            {decided.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {decided.map((row) => (
                  <li key={row.id} className="flex flex-col gap-1 py-3" data-testid="payout-decided-row">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{row.tutorName ?? row.tutorEmail}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant={row.status === 'paid' ? 'success' : 'destructive'}>
                          {PAYOUT_STATUS_LABELS[row.status as PayoutStatus]}
                        </Badge>
                        <span className="tabular-nums">{formatCents(row.amountCents)}</span>
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {row.decidedAt ? formatInTimeZone(row.decidedAt, admin.timezone) : '—'}
                      {row.paidRef ? ` · ${row.paidRef}` : ''}
                      {row.rejectReason ? ` · ${row.rejectReason}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
