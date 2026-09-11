/**
 * The admin dashboard (SPEC.md §10).
 *
 * Two numbers on this page are load-bearing and everything else is context.
 *
 * The first is the **float**: credits sold is cash in the bank, credits
 * outstanding is tutoring we owe and have not delivered. They are not the same
 * money and a marketplace that treats the first as revenue eventually spends
 * the second. It sits at the top, at full width, before anything else.
 *
 * The second is **unmatched demand**: every curriculum position a student has
 * declared that no verified tutor teaches. It is the only thing here that says
 * what to do next rather than what already happened, so it is a section rather
 * than a tile.
 *
 * All the SQL is in `src/db/metrics.ts`. This file arranges it.
 */

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
import { askedAndMissing } from '@/db/demand';
import { formatReconciliationReport, reconcileLedger } from '@/db/ledger';
import {
  moneyOverview,
  operations,
  packMargins,
  providerSplit,
  topCurriculumPositions,
  topSubjects,
  unmatchedDemand,
  unusedProviders,
} from '@/db/metrics';
import { payoutQueue } from '@/db/payouts';
import { db } from '@/db/client';
import { tutorProfiles, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import {
  ABSORBED_FAILURE_WINDOW_DAYS,
  MAX_ABSORBED_FAILURES_PER_STUDENT,
} from '@/lib/money/outcomes';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin' };

/**
 * A rate, or an em dash when there was nothing to divide by.
 *
 * `bps(0, 0)` is 0, and "0.0%" is a claim: it says nobody converts, nobody
 * cancels, nothing is covered. On day one every denominator here is zero and
 * every one of those statements is false — we have no data, which is a
 * different thing and reads differently.
 *
 * `whole` is optional so the call sites that genuinely cannot be empty (a
 * blended take rate over real money) stay as they were.
 */
function pct(basisPoints: number, whole?: number): string {
  if (whole !== undefined && whole <= 0) return '—';
  return `${(basisPoints / 100).toFixed(1)}%`;
}

const NAV = [
  // First, because it is the one to open before the numbers.
  { href: '/admin/alerts', label: 'Alerts' },
  { href: '/admin/invite', label: 'Invite a tutor' },
  { href: '/admin/verification', label: 'Verification' },
  { href: '/admin/payouts', label: 'Payouts' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/packs', label: 'Packs' },
  { href: '/admin/curriculum', label: 'Curriculum' },
];

export default async function AdminPage() {
  const admin = await requireRole('admin');

  const [money, ops, packs, providers, subjects, positions, unmatched, asked, reconciliation, payouts, verification] =
    await Promise.all([
      moneyOverview(),
      operations(),
      packMargins(),
      providerSplit(),
      topSubjects(8),
      topCurriculumPositions(8),
      unmatchedDemand(12),
      askedAndMissing(10),
      reconcileLedger(db),
      payoutQueue(),
      db
        .select({ id: tutorProfiles.userId, name: users.name, submittedAt: tutorProfiles.submittedAt })
        .from(tutorProfiles)
        .innerJoin(users, eq(users.id, tutorProfiles.userId))
        .where(eq(tutorProfiles.status, 'pending_review'))
        .orderBy(tutorProfiles.submittedAt)
        .limit(10),
    ]);

  // The share of the float already delivered, for the bar below.
  const consumedShare =
    money.creditsIssuedCents > 0
      ? Math.round((money.creditsConsumedCents * 100) / money.creditsIssuedCents)
      : 0;

  const idle = unusedProviders(providers);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <nav aria-label="Admin sections" className="flex flex-wrap gap-2">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                <Button size="sm" variant="outline">
                  {item.label}
                </Button>
              </Link>
            ))}
          </nav>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* The float. First, full width, unmissable.                      */}
        {/* ------------------------------------------------------------- */}
        <Card className="border-2 border-foreground/15" data-testid="float">
          <CardHeader>
            <CardTitle>Credits sold against credits consumed</CardTitle>
            <CardDescription>
              The gap is the float: cash we hold for tutoring that has not happened yet. It is a
              liability, not revenue.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Sold</p>
                <p className="text-3xl font-semibold tabular-nums" data-testid="credits-sold">
                  {formatCents(money.creditsSoldCents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cash taken. {formatCents(money.creditsIssuedCents)} of spending power issued —{' '}
                  {formatCents(money.bonusIssuedCents)} of that was bonus.
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Consumed</p>
                <p className="text-3xl font-semibold tabular-nums" data-testid="credits-consumed">
                  {formatCents(money.creditsConsumedCents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Spent on sessions and delivered.</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding — the float</p>
                <p
                  className="text-3xl font-semibold tabular-nums text-[var(--warning,inherit)]"
                  data-testid="credits-outstanding"
                >
                  {formatCents(money.creditsOutstandingCents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sitting in student wallets. We owe this in lessons.
                </p>
              </div>
            </div>

            <div>
              <div
                className="h-3 w-full overflow-hidden rounded-full bg-secondary"
                role="img"
                aria-label={`${consumedShare}% of issued credits consumed, ${100 - consumedShare}% still outstanding`}
              >
                <div className="h-full bg-foreground/70" style={{ width: `${consumedShare}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {consumedShare}% of everything ever issued has been delivered.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* Money                                                          */}
        {/* ------------------------------------------------------------- */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Money</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['GMV (settled)', formatCents(money.gmvCents), 'Everything that changed hands.'],
                [
                  'Net revenue',
                  formatCents(money.platformRevenueCents),
                  'Our share, from the ledger.',
                ],
                [
                  'Effective take rate',
                  pct(money.takeRateBps, money.gmvCents),
                  'Blended across every rate we have charged.',
                ],
                [
                  'Owed to tutors',
                  formatCents(money.payoutLiabilityCents),
                  'Pending plus available plus locked.',
                ],
                ['Held in escrow', formatCents(money.escrowCents), 'Sessions not yet settled.'],
                [
                  'Locked for payout',
                  formatCents(money.lockedForPayoutCents),
                  'Requested and awaiting a transfer.',
                ],
                ['Paid out', formatCents(money.paidOutCents), 'Money that has left the platform.'],
                ['Sessions settled', String(ops.sessionsCompleted), 'Lifetime.'],
              ] as const
            ).map(([label, value, note]) => (
              <Card key={label}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardMetric>{value}</CardMetric>
                  <p className="text-xs text-muted-foreground">{note}</p>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------------- */}
        {/* Unmatched demand                                               */}
        {/* ------------------------------------------------------------- */}
        <Card data-testid="unmatched-demand">
          <CardHeader>
            <CardTitle>Unmatched demand</CardTitle>
            <CardDescription>
              Curriculum positions students have told us they study that no verified tutor teaches.
              This is the recruiting list.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Positions with nobody</p>
                <p className="text-3xl font-semibold tabular-nums" data-testid="unmatched-count">
                  {unmatched.positionsUnmatched}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  of {unmatched.positionsDeclared} declared —{' '}
                  {pct(
                    unmatched.positionsDeclared > 0
                      ? Math.round((unmatched.positionsUnmatched * 10_000) / unmatched.positionsDeclared)
                      : 0,
                    unmatched.positionsDeclared,
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Students affected</p>
                <p className="text-3xl font-semibold tabular-nums">{unmatched.studentsAffected}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  At least one thing they study has no tutor.
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Coverage</p>
                <p className="text-3xl font-semibold tabular-nums">
                  {pct(
                    unmatched.positionsDeclared > 0
                      ? Math.round(
                          ((unmatched.positionsDeclared - unmatched.positionsUnmatched) * 10_000) /
                            unmatched.positionsDeclared,
                        )
                      : 0,
                    unmatched.positionsDeclared,
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Declared positions we can serve.</p>
              </div>
            </div>

            {unmatched.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every position a student has declared has at least one verified tutor.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-140 text-sm">
                  <caption className="sr-only">
                    Curriculum positions with student demand and no verified tutor
                  </caption>
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Board</th>
                      <th className="py-2 pr-3 font-medium">Level</th>
                      <th className="py-2 pr-3 font-medium">Subject</th>
                      <th className="py-2 pr-3 text-right font-medium">Students</th>
                      <th className="py-2 text-right font-medium">Near tutors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatched.rows.map((row) => (
                      <tr
                        key={`${row.board}-${row.level}-${row.subject}`}
                        className="border-b border-border last:border-0"
                        data-testid="unmatched-row"
                      >
                        <td className="py-2 pr-3">{row.board}</td>
                        <td className="py-2 pr-3">{row.level}</td>
                        <td className="py-2 pr-3">{row.subject}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.students}</td>
                        <td className="py-2 text-right tabular-nums">{row.nearTutors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              <strong>Near tutors</strong> teach the same subject at the same stage under a different
              board. A row with several of them is a conversation — they may already be able to teach
              it and have not said so. A row with none is a hire.
            </p>

            {/* The other half of demand, and at launch the more useful one: the
                table above needs a student to have *declared* a position, and
                most people looking on day one have not signed up at all. */}
            <div className="border-t border-border pt-4">
              <p className="text-sm font-medium">Searched for and not found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Somebody filtered to this position and got nothing, in the last 90 days. Signed-out
                visitors count once a day per position — we cannot tell two of them apart, and
                pretending otherwise would inflate the list you recruit from.
              </p>

              {asked.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nobody has searched for a position we cannot serve.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-120 text-sm">
                    <caption className="sr-only">Positions people searched for and did not find</caption>
                    <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-3 font-medium">Board</th>
                        <th className="py-2 pr-3 font-medium">Level</th>
                        <th className="py-2 pr-3 font-medium">Subject</th>
                        <th className="py-2 pr-3 text-right font-medium">Asks</th>
                        <th className="py-2 text-right font-medium">Signed in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {asked.map((row) => (
                        <tr
                          key={`${row.board}-${row.level}-${row.subject}`}
                          className="border-b border-border last:border-0"
                          data-testid="asked-row"
                        >
                          <td className="py-2 pr-3">{row.board}</td>
                          <td className="py-2 pr-3">{row.level}</td>
                          <td className="py-2 pr-3">{row.subject}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{row.asks}</td>
                          <td className="py-2 text-right tabular-nums">{row.signedIn}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* Packs                                                          */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Margin per pack</CardTitle>
            <CardDescription>
              What each pack is really worth after the payment provider takes its cut and the credits —
              bonus included — are paid out to tutors at the blended {pct(packs.takeRateBps)} take rate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {packs.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing sold yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-160 text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Pack</th>
                      <th className="py-2 pr-3 text-right font-medium">Sold</th>
                      <th className="py-2 pr-3 text-right font-medium">Cash in</th>
                      <th className="py-2 pr-3 text-right font-medium">Bonus</th>
                      <th className="py-2 pr-3 text-right font-medium">Provider fees</th>
                      <th className="py-2 pr-3 text-right font-medium">Tutor cost</th>
                      <th className="py-2 text-right font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packs.rows.map((pack) => (
                      <tr
                        key={pack.packId}
                        className="border-b border-border last:border-0"
                        data-testid="pack-margin"
                        data-pack={pack.packId}
                      >
                        <td className="py-2 pr-3">{pack.name}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{pack.purchases}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatCents(pack.cashInCents)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {pack.bonusCents > 0 ? `−${formatCents(pack.bonusCents)}` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          −{formatCents(pack.providerFeesCents)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          −{formatCents(pack.tutorCostCents)}
                        </td>
                        <td className="py-2 text-right tabular-nums font-medium">
                          {formatCents(pack.marginCents)}{' '}
                          <Badge variant={pack.marginBps < 500 ? 'destructive' : 'outline'}>
                            {pct(pack.marginBps, pack.cashInCents)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Tutor cost is what the credits will pay out over their life, not what has been paid so
              far. A pack that sells well at a thin margin is still a decision, but it should be one
              taken on purpose.
            </p>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* Providers and operations                                       */}
        {/* ------------------------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>How students pay</CardTitle>
              <CardDescription>Card against local rails, by cash taken.</CardDescription>
            </CardHeader>
            <CardContent>
              {providers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchases yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {providers.map((row) => (
                    <li key={row.provider} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        {row.label}{' '}
                        <span className="text-xs text-muted-foreground">
                          {row.purchases} purchase{row.purchases === 1 ? '' : 's'}, fees{' '}
                          {formatCents(row.feesCents)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{formatCents(row.cashInCents)}</span>
                        <Badge variant="secondary">{pct(row.shareBps, row.cashInCents)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {idle.length > 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Configured but unused: {idle.join(', ')}.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How it is going</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col divide-y divide-border text-sm">
                {(
                  [
                    [
                      'Trial to paid',
                      pct(ops.trialToPaidBps, ops.trials),
                      `${ops.trialsConverted} of ${ops.trials} trial pairs came back and paid.`,
                    ],
                    [
                      'Cancelled by student',
                      pct(ops.cancellationStudentBps, ops.bookingsTerminal),
                      `${ops.cancelledByStudent} of ${ops.bookingsTerminal} finished bookings.`,
                    ],
                    [
                      'Cancelled by tutor',
                      pct(ops.cancellationTutorBps, ops.bookingsTerminal),
                      `${ops.cancelledByTutor} of ${ops.bookingsTerminal}. This one costs us students.`,
                    ],
                    [
                      'No-shows',
                      `${ops.noShowStudent} / ${ops.noShowTutor}`,
                      'Student / tutor.',
                    ],
                    [
                      'Failures absorbed',
                      String(ops.absorbedFailures),
                      `${ops.studentsAtCap} student${ops.studentsAtCap === 1 ? '' : 's'} at the cap of ${MAX_ABSORBED_FAILURES_PER_STUDENT} per ${ABSORBED_FAILURE_WINDOW_DAYS} days.`,
                    ],
                    ['Verified tutors', String(ops.activeTutors), `${ops.pendingVerifications} waiting to be reviewed.`],
                  ] as const
                ).map(([label, value, note]) => (
                  // A `dl` may group with `div`, but each group has to contain
                  // only the term and its definition — so the number is the
                  // `dd` and the note lives inside the `dt` it describes.
                  <div key={label} className="flex items-baseline justify-between gap-3 py-2">
                    <dt>
                      <span className="font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{note}</span>
                    </dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* What people study and book                                     */}
        {/* ------------------------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top subjects</CardTitle>
              <CardDescription>By settled GMV.</CardDescription>
            </CardHeader>
            <CardContent>
              {subjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing settled yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {subjects.map((row) => (
                    <li key={row.subject} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        {row.subject}{' '}
                        <span className="text-xs text-muted-foreground">{row.sessions} sessions</span>
                      </span>
                      <span className="tabular-nums">{formatCents(row.gmvCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top curriculum positions</CardTitle>
              <CardDescription>What students say they study, and who can teach it.</CardDescription>
            </CardHeader>
            <CardContent>
              {positions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody has declared a position yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {positions.map((row) => (
                    <li
                      key={`${row.board}-${row.level}-${row.subject}`}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span>
                        {row.subject}{' '}
                        <span className="text-xs text-muted-foreground">
                          {row.board} · {row.level}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{row.students}</span>
                        <Badge variant={row.tutors === 0 ? 'destructive' : 'outline'}>
                          {row.tutors} tutor{row.tutors === 1 ? '' : 's'}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* Queues                                                         */}
        {/* ------------------------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Verification</CardTitle>
                  <CardDescription>{ops.pendingVerifications} waiting</CardDescription>
                </div>
                <Link href="/admin/verification">
                  <Button size="sm">Open</Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {verification.length === 0 ? (
                <p className="text-sm text-muted-foreground">Empty.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {verification.map((tutor) => (
                    <li key={tutor.id} className="flex items-center justify-between gap-3 py-2">
                      <span>{tutor.name}</span>
                      <span className="text-xs text-muted-foreground">
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Payouts</CardTitle>
                  <CardDescription>{payouts.length} open</CardDescription>
                </div>
                <Link href="/admin/payouts">
                  <Button size="sm" data-testid="open-payout-queue">
                    Open
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {payouts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Empty.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {payouts.map((payout) => (
                    <li key={payout.id} className="flex items-center justify-between gap-3 py-2">
                      <span>{payout.tutorName ?? payout.tutorEmail}</span>
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

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Reports</CardTitle>
                  <CardDescription>{ops.openReports} unresolved</CardDescription>
                </div>
                <Link href="/admin/reports">
                  <Button size="sm" variant={ops.openReports > 0 ? 'default' : 'outline'}>
                    Open
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Tutors, students, messages and sessions people have flagged.
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* Ledger                                                         */}
        {/* ------------------------------------------------------------- */}
        <Card className={reconciliation.ok ? '' : 'border-destructive'}>
          <CardHeader>
            <CardTitle>Ledger</CardTitle>
            <CardDescription>
              Every materialised balance compared against the sum of its ledger rows. If this ever
              disagrees, nothing else on this page can be trusted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
              {formatReconciliationReport(reconciliation)}
            </pre>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
