/**
 * Admin overview: the queues from SPEC.md §10 and the money that matters.
 *
 * Read-only in Phase 0. Approving a tutor, paying a payout and the audit log
 * land in phases 1 and 6 — and every one of those actions will write an
 * `admin_audit` row.
 */

import { desc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardMetric,
  CardTitle,
} from '@/components/ui/card';
import { db } from '@/db/client';
import { payouts, tutorProfiles, users } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { formatReconciliationReport, reconcileLedger } from '@/db/ledger';
import { formatCents } from '@/lib/money/cents';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin' };

type Totals = {
  gmv_cents: string;
  platform_revenue_cents: string;
  credits_sold_cents: string;
  credits_outstanding_cents: string;
  escrow_cents: string;
  payout_liability_cents: string;
  sessions_completed: number;
  active_tutors: number;
  pending_verifications: number;
};

export default async function AdminPage() {
  const admin = await requireRole('admin');

  const [totals] = (await db.execute(sql`
    select
      coalesce((select sum(price_cents) from bookings where status = 'settled'), 0)::bigint as gmv_cents,
      coalesce((select balance_cents from platform_accounts where account = 'platform_revenue'), 0)::bigint as platform_revenue_cents,
      coalesce((select sum(credits_cents) from credit_purchases where status = 'paid'), 0)::bigint as credits_sold_cents,
      coalesce((select sum(credits_cents) from student_wallets), 0)::bigint as credits_outstanding_cents,
      coalesce((select sum(escrow_cents) from bookings), 0)::bigint as escrow_cents,
      coalesce((select sum(available_cents + pending_cents + payout_locked_cents) from tutor_profiles), 0)::bigint as payout_liability_cents,
      (select count(*) from bookings where status = 'settled')::int as sessions_completed,
      (select count(*) from tutor_profiles where status = 'verified')::int as active_tutors,
      (select count(*) from tutor_profiles where status = 'pending_review')::int as pending_verifications
  `)) as unknown as [Totals];

  const verificationQueue = await db
    .select({
      id: tutorProfiles.userId,
      name: users.name,
      email: users.email,
      submittedAt: tutorProfiles.submittedAt,
      hourlyCents: tutorProfiles.hourlyCents,
    })
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .where(eq(tutorProfiles.status, 'pending_review'))
    .orderBy(tutorProfiles.submittedAt)
    .limit(20);

  const payoutQueue = await db
    .select({
      id: payouts.id,
      amountCents: payouts.amountCents,
      status: payouts.status,
      requestedAt: payouts.requestedAt,
      name: users.name,
      email: users.email,
    })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.tutorId))
    .where(eq(payouts.status, 'requested'))
    .orderBy(desc(payouts.requestedAt))
    .limit(20);

  const reconciliation = await reconcileLedger(db);

  const takeRateBps =
    Number(totals.gmv_cents) > 0
      ? Math.round((Number(totals.platform_revenue_cents) * 10_000) / Number(totals.gmv_cents))
      : 0;

  const metrics: { label: string; value: string; note?: string }[] = [
    { label: 'GMV (settled)', value: formatCents(Number(totals.gmv_cents)) },
    { label: 'Platform revenue', value: formatCents(Number(totals.platform_revenue_cents)) },
    { label: 'Effective take rate', value: `${(takeRateBps / 100).toFixed(1)}%` },
    { label: 'Credits sold', value: formatCents(Number(totals.credits_sold_cents)) },
    {
      label: 'Credits outstanding',
      value: formatCents(Number(totals.credits_outstanding_cents)),
      note: 'float / liability',
    },
    { label: 'Held in escrow', value: formatCents(Number(totals.escrow_cents)) },
    {
      label: 'Owed to tutors',
      value: formatCents(Number(totals.payout_liability_cents)),
      note: 'pending + available + locked',
    },
    { label: 'Sessions completed', value: String(totals.sessions_completed) },
  ];

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>

        <Card className={reconciliation.ok ? '' : 'border-destructive'}>
          <CardHeader>
            <CardTitle>Ledger</CardTitle>
            <CardDescription>
              Every materialised balance compared against the sum of its ledger rows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
              {formatReconciliationReport(reconciliation)}
            </pre>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <Card key={metric.label}>
              <CardHeader>
                <CardDescription>{metric.label}</CardDescription>
                <CardMetric>{metric.value}</CardMetric>
                {metric.note ? (
                  <p className="text-xs text-muted-foreground">{metric.note}</p>
                ) : null}
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Verification queue</CardTitle>
                  <CardDescription>{totals.pending_verifications} waiting</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Link href="/admin/verification">
                    <Button size="sm">Open queue</Button>
                  </Link>
                  <Link href="/admin/moderation">
                    <Button size="sm" variant="outline">
                      Moderation
                    </Button>
                  </Link>
                  <Link href="/admin/packs">
                    <Button size="sm" variant="outline">
                      Packs
                    </Button>
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {verificationQueue.length === 0 ? (
                <p className="text-sm text-muted-foreground">Empty.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {verificationQueue.map((tutor) => (
                    <li key={tutor.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <p className="font-medium">{tutor.name}</p>
                        <p className="text-muted-foreground">{tutor.email}</p>
                      </div>
                      <span className="text-muted-foreground">
                        {tutor.submittedAt ? formatInTimeZone(tutor.submittedAt, admin.timezone) : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payout requests</CardTitle>
              <CardDescription>{payoutQueue.length} waiting</CardDescription>
            </CardHeader>
            <CardContent>
              {payoutQueue.length === 0 ? (
                <p className="text-sm text-muted-foreground">Empty.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {payoutQueue.map((payout) => (
                    <li key={payout.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <p className="font-medium">{payout.name}</p>
                        <p className="text-muted-foreground">
                          {formatInTimeZone(payout.requestedAt, admin.timezone)}
                        </p>
                      </div>
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary">{payout.status}</Badge>
                        <span className="tabular-nums">{formatCents(payout.amountCents)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="text-sm text-muted-foreground">
          {totals.active_tutors} verified tutors. The dispute queue and payout decisions arrive with Phase 6.
        </p>
      </main>
    </>
  );
}
