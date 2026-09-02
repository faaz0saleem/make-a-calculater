/**
 * The tutor's home: verification status, rates, balances and payout eligibility.
 *
 * The wizard from SPEC.md §3 and the earnings history land in phases 1 and 6.
 */

import { and, desc, eq, gte, inArray } from 'drizzle-orm';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db/client';
import { bookings, payouts, tutorProfiles, users } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { canRequestPayout, PAYOUT_THRESHOLD_CENTS } from '@/lib/money/payouts';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teaching' };

const STATUS_COPY: Record<string, string> = {
  draft: 'Finish your profile and submit it for review to appear in the feed.',
  pending_review: 'Submitted. An admin is reviewing your credentials.',
  verified: 'Verified. You appear in the feed and can take bookings.',
  rejected: 'Rejected. Fix the noted issue and submit again.',
  suspended: 'Suspended. Contact support.',
};

export default async function TutorPage() {
  const user = await requireRole('tutor');

  const [profile] = await db
    .select()
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-10">
          <Card>
            <CardHeader>
              <CardTitle>No tutor profile yet</CardTitle>
              <CardDescription>The onboarding wizard arrives in Phase 1.</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </>
    );
  }

  const upcoming = await db
    .select({
      id: bookings.id,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      studentName: users.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.studentId))
    .where(
      and(
        eq(bookings.tutorId, user.id),
        gte(bookings.startAtUtc, new Date()),
        inArray(bookings.status, ['pending_tutor', 'confirmed', 'in_progress']),
      ),
    )
    .orderBy(bookings.startAtUtc)
    .limit(10);

  const payoutHistory = await db
    .select()
    .from(payouts)
    .where(eq(payouts.tutorId, user.id))
    .orderBy(desc(payouts.requestedAt))
    .limit(5);

  const eligibility = canRequestPayout(profile.availableCents, profile.availableCents);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Teaching</h1>
          <Badge variant={profile.status === 'verified' ? 'success' : 'secondary'}>{profile.status}</Badge>
        </div>
        <p className="-mt-4 text-sm text-muted-foreground">{STATUS_COPY[profile.status]}</p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Available</CardDescription>
              <CardTitle className="text-2xl">{formatCents(profile.availableCents)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Pending</CardDescription>
              <CardTitle className="text-2xl">{formatCents(profile.pendingCents)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Locked for payout</CardDescription>
              <CardTitle className="text-2xl">{formatCents(profile.payoutLockedCents)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Earned all time</CardDescription>
              <CardTitle className="text-2xl">{formatCents(profile.lifetimeEarnedCents)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Payouts</CardTitle>
            <CardDescription>
              The threshold is {formatCents(PAYOUT_THRESHOLD_CENTS)} of available balance.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className={eligibility.ok ? 'text-[var(--success)]' : 'text-muted-foreground'}>
              {eligibility.ok
                ? `You can request up to ${formatCents(profile.availableCents)}.`
                : eligibility.reason}
            </p>
            {payoutHistory.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {payoutHistory.map((payout) => (
                  <li key={payout.id} className="flex items-center justify-between py-2">
                    <span>{formatInTimeZone(payout.requestedAt, user.timezone)}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{payout.status}</Badge>
                      <span className="tabular-nums">{formatCents(payout.amountCents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Requesting moves the amount out of your available balance immediately so it cannot be spent
              twice. Admin approval and the bank transfer arrive in Phase 6.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Your rates</CardTitle>
              <CardDescription>Changing these never reprices a confirmed booking.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <p>60 minutes — {formatCents(profile.hourlyCents)}</p>
              <p>30 minutes — {formatCents(profile.halfHourCents)}</p>
              <p className="text-muted-foreground">
                Platform commission {(profile.commissionBps / 100).toFixed(0)}% · you keep{' '}
                {((10_000 - profile.commissionBps) / 100).toFixed(0)}%
              </p>
              <p className="text-muted-foreground">
                {profile.offersTrial
                  ? `Free trial on — ${profile.trialMinutes} minutes, up to ${profile.maxTrialsPerWeek} a week`
                  : 'Free trial off'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming sessions</CardTitle>
              <CardDescription>Shown in {user.timezone}</CardDescription>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing booked yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {upcoming.map((booking) => (
                    <li key={booking.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <p className="font-medium">{booking.studentName}</p>
                        <p className="text-muted-foreground">
                          {formatInTimeZone(booking.startAtUtc, user.timezone)} · {booking.durationMinutes} min
                        </p>
                      </div>
                      {booking.isTrial ? (
                        <Badge variant="success">Trial</Badge>
                      ) : (
                        <span className="tabular-nums">{formatCents(booking.priceCents)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
