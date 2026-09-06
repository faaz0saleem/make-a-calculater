/**
 * The tutor's home: verification status, rates, balances and payout eligibility.
 *
 * The wizard from SPEC.md §3 and the earnings history land in phases 1 and 6.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import Link from 'next/link';

import {
  answerRescheduleAction,
  cancelBookingAction,
  reportProblemAction,
  requestRescheduleAction,
} from '@/app/dashboard/actions';
import { answerTrial, postReviewReply } from '@/app/tutor/actions';
import { BookingActions, RescheduleInbox } from '@/components/bookings/booking-actions';
import { withdrawProfile } from '@/app/tutor/onboarding/actions';
import { TutorReviews } from '@/components/reviews/tutor-reviews';
import { TrialRequests } from '@/components/trials/trial-requests';
import { JoinLink } from '@/components/sessions/join-link';
import { StandingSlots } from '@/components/series/standing-slots';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardMetric,
  CardTitle,
} from '@/components/ui/card';
import { db } from '@/db/client';
import { bookings, payouts, tutorProfiles, users } from '@/db/schema';
import { openReschedulesFor } from '@/db/bookings';
import { ratingSummaryFor, reviewsForTutor } from '@/db/reviews';
import { pendingTrialsForTutor } from '@/db/trials';
import { loadWizardSnapshot } from '@/db/tutors';
import { requireRole } from '@/lib/auth/guards';
import { wizardProgress } from '@/lib/tutors/wizard';
import { seriesFor } from '@/db/series';
import { stopSeries } from '@/app/tutors/[tutorId]/series/actions';
import { formatCents } from '@/lib/money/cents';
import { takeHomeFor } from '@/lib/money/commission';
import {
  canRequestPayout,
  PAYOUT_STATUS_LABELS,
  PAYOUT_THRESHOLD_CENTS,
  type PayoutStatus,
} from '@/lib/money/payouts';
import { sessionWindow } from '@/lib/sessions/window';
import { cn } from '@/lib/utils';
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

export default async function TutorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; moved?: string; reported?: string; cancelled?: string }>;
}) {
  const user = await requireRole('tutor');
  const now = new Date();
  const query = await searchParams;

  const [profile] = await db
    .select()
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
          <Card>
            <CardHeader>
              <CardTitle>No tutor profile yet</CardTitle>
              <CardDescription>
                Something went wrong when your account was created. Contact support.
              </CardDescription>
            </CardHeader>
          </Card>
        </main>
      </>
    );
  }

  const standing = await seriesFor(user.id, 'tutor', db, now);
  const snapshot = await loadWizardSnapshot(user.id);
  const progress = snapshot ? wizardProgress(snapshot) : null;

  const upcoming = await db
    .select({
      id: bookings.id,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      studentName: users.name,
      topicNote: bookings.topicNote,
      // What the session is for, so the tutor can prepare rather than spend the
      // first five minutes of a paid hour finding out.
      topics: sql<string | null>`(
        select string_agg(t.name, ', ' order by t.sort_order)
        from booking_topics bt join topics t on t.id = bt.topic_id
        where bt.booking_id = ${bookings.id}
      )`,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.studentId))
    .where(
      and(
        eq(bookings.tutorId, user.id),
        sql`${bookings.startAtUtc} + make_interval(mins => ${bookings.durationMinutes}) >= now()`,
        inArray(bookings.status, ['scheduled', 'pending_tutor', 'confirmed', 'in_progress']),
      ),
    )
    .orderBy(bookings.startAtUtc)
    .limit(10);

  const [trialRequests, ratings, reviews, reschedules] = await Promise.all([
    pendingTrialsForTutor(user.id, now),
    ratingSummaryFor(user.id),
    reviewsForTutor(user.id),
    openReschedulesFor(user.id, now),
  ]);

  // Sessions recent enough that either side can still report a problem.
  const recent = await db
    .select({
      id: bookings.id,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      rescheduleCount: bookings.rescheduleCount,
      completedAt: bookings.completedAt,
      settledAt: bookings.settledAt,
      studentName: users.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.studentId))
    .where(
      and(
        eq(bookings.tutorId, user.id),
        sql`${bookings.startAtUtc} + make_interval(mins => ${bookings.durationMinutes}) < now()`,
      ),
    )
    .orderBy(desc(bookings.startAtUtc))
    .limit(5);

  const payoutHistory = await db
    .select()
    .from(payouts)
    .where(eq(payouts.tutorId, user.id))
    .orderBy(desc(payouts.requestedAt))
    .limit(5);

  const eligibility = canRequestPayout(profile.availableCents, profile.availableCents);

  // What a tutor actually receives, not just what they charge.
  const takeHome = takeHomeFor(profile.hourlyCents, profile.commissionBps);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 sm:px-6 py-10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Teaching</h1>
          <Badge variant={profile.status === 'verified' ? 'success' : 'secondary'}>{profile.status}</Badge>
        </div>
        <p className="-mt-4 text-sm text-muted-foreground">{STATUS_COPY[profile.status]}</p>

        {profile.status === 'rejected' && profile.rejectionReason ? (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">Why your profile was not accepted</p>
            <p className="mt-1 text-destructive">{profile.rejectionReason}</p>
          </div>
        ) : null}

        {progress && profile.status !== 'verified' ? (
          <Card>
            <CardHeader>
              <CardTitle>Your profile</CardTitle>
              <CardDescription>
                {progress.completedRequired} of {progress.totalRequired} steps done.
                {progress.canSubmit ? ' Ready to submit.' : ` Next: ${progress.blocking[0]?.title ?? ''}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.round((progress.completedRequired / progress.totalRequired) * 100)}%`,
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {profile.status === 'pending_review' ? (
                  <form action={withdrawProfile}>
                    <Button type="submit" variant="outline" size="sm">
                      Withdraw and keep editing
                    </Button>
                  </form>
                ) : (
                  <Link href="/tutor/onboarding">
                    <Button size="sm">
                      {progress.completedRequired === 0 ? 'Start your profile' : 'Continue where you left off'}
                    </Button>
                  </Link>
                )}
                <Link
                  href={`/tutors/${user.id}`}
                  className="text-sm text-muted-foreground underline underline-offset-4"
                >
                  Preview public profile
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {profile.status === 'verified' ? (
          <p className="-mt-2 text-sm">
            <Link href={`/tutors/${user.id}`} className="underline underline-offset-4">
              View your public profile
            </Link>
            {' · '}
            <Link href="/tutor/onboarding" className="underline underline-offset-4">
              Review your details
            </Link>
          </p>
        ) : null}

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {query.moved ? (
          <p role="status" className="rounded-md bg-[var(--success)]/10 px-4 py-3 text-sm">
            Done — the session has moved.
          </p>
        ) : null}

        {query.reported ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm">
            Reported. Nothing settles on that session until our team has looked at it.
          </p>
        ) : null}

        <RescheduleInbox
          requests={reschedules}
          userId={user.id}
          timezone={user.timezone}
          now={now}
          returnTo="/tutor"
          action={answerRescheduleAction}
        />

        <TrialRequests
          requests={trialRequests}
          timezone={user.timezone}
          now={now}
          action={answerTrial}
        />

        <StandingSlots
          series={standing}
          viewer="tutor"
          timezone={user.timezone}
          endAction={stopSeries}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Available</CardDescription>
              <CardMetric>{formatCents(profile.availableCents)}</CardMetric>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Pending</CardDescription>
              <CardMetric>{formatCents(profile.pendingCents)}</CardMetric>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Locked for payout</CardDescription>
              <CardMetric>{formatCents(profile.payoutLockedCents)}</CardMetric>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Earned all time</CardDescription>
              <CardMetric>{formatCents(profile.lifetimeEarnedCents)}</CardMetric>
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
                      <Badge variant="outline">{PAYOUT_STATUS_LABELS[payout.status as PayoutStatus]}</Badge>
                      <span className="tabular-nums">{formatCents(payout.amountCents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <Link
              href="/tutor/earnings"
              data-testid="open-earnings"
              className={cn(buttonVariants({ variant: 'outline' }), 'self-start')}
            >
              Earnings and withdrawals
            </Link>
            <p className="text-xs text-muted-foreground">
              Requesting moves the amount out of your available balance immediately so it cannot be spent
              twice. The earnings page shows every session at the rate it was booked at, and where we
              send the money.
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

              <p data-testid="take-home">
                <strong className="font-medium">
                  You&rsquo;ll receive {formatCents(takeHome.firstCents)} of a{' '}
                  {formatCents(profile.hourlyCents)} lesson
                </strong>{' '}
                from a new student, and {formatCents(takeHome.rebookingCents)} once they come back.
              </p>

              <p className="text-muted-foreground">
                That is {(takeHome.firstBps / 100).toFixed(0)}% commission on a student&rsquo;s first
                session with you and {(takeHome.rebookingBps / 100).toFixed(0)}% on every one after —
                keeping a student is worth more to us than finding one.
                {takeHome.negotiated
                  ? ` Your negotiated rate of ${(takeHome.firstBps / 100).toFixed(0)}% applies whichever it is.`
                  : ''}
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
                    <li
                      key={booking.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{booking.studentName}</p>
                        <p className="text-muted-foreground">
                          {formatInTimeZone(booking.startAtUtc, user.timezone)} · {booking.durationMinutes} min
                        </p>
                        {booking.topics ? (
                          <p className="text-xs text-muted-foreground" data-testid="upcoming-topics">
                            {booking.topics}
                          </p>
                        ) : null}
                        {booking.topicNote ? (
                          <p className="text-xs italic text-muted-foreground">
                            &ldquo;{booking.topicNote}&rdquo;
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {booking.isTrial ? (
                          <Badge variant="success">Trial</Badge>
                        ) : (
                          <span className="tabular-nums">{formatCents(booking.priceCents)}</span>
                        )}
                        <JoinLink booking={booking} timezone={user.timezone} now={now} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
            <CardDescription>
              If one of these went wrong, say so while the money is still held.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {recent.map((booking) => (
                  <li key={booking.id} className="flex flex-col gap-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0">
                        <p className="font-medium">{booking.studentName}</p>
                        <p className="text-muted-foreground">
                          {formatInTimeZone(booking.startAtUtc, user.timezone)} ·{' '}
                          {booking.durationMinutes} min
                        </p>
                      </div>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">{booking.status}</Badge>
                        <Link href={`/tutor/sessions/${booking.id}`}>
                          <Button size="sm" variant="outline" data-testid="after-session">
                            What happened
                          </Button>
                        </Link>
                      </span>
                    </div>

                    <BookingActions
                      booking={booking}
                      now={now}
                      timezone={user.timezone}
                      returnTo="/tutor"
                      freeSlots={[]}
                      canReport={
                        !booking.settledAt &&
                        booking.status !== 'disputed' &&
                        now < sessionWindow(booking.startAtUtc, booking.durationMinutes).settlesAfterUtc
                      }
                      cancelAction={cancelBookingAction}
                      rescheduleAction={requestRescheduleAction}
                      reportAction={reportProblemAction}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <TutorReviews
          summary={ratings}
          reviews={reviews}
          timezone={user.timezone}
          action={postReviewReply}
        />
      </main>
    </>
  );
}
