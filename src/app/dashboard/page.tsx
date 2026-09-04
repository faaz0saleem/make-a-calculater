/**
 * The student's dashboard: wallet balance, upcoming sessions, recent history.
 *
 * Every query is filtered by the session's user id. There is no route by which
 * a client can ask for another student's rows.
 */

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import { submitReview } from '@/app/dashboard/actions';
import { ReviewPrompt } from '@/components/reviews/review-prompt';
import { JoinLink } from '@/components/sessions/join-link';
import { OutgoingTrials } from '@/components/trials/outgoing-trials';
import { TrialConversion, type ConversionSlot } from '@/components/trials/trial-conversion';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardMetric,
  CardTitle,
} from '@/components/ui/card';
import { db } from '@/db/client';
import { bookings, studentWallets, users } from '@/db/schema';
import { reviewableSessionsFor } from '@/db/reviews';
import { pendingTrialsForStudent, recentTrialToConvert } from '@/db/trials';
import { getAvailability } from '@/lib/availability';
import { requireUser } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { cancellationConsequence } from '@/lib/sessions/cancellation';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your dashboard' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ reviewError?: string; reviewed?: string; requested?: string }>;
}) {
  const user = await requireUser();
  const now = new Date();
  const query = await searchParams;

  const [wallet] = await db
    .select({
      creditsCents: studentWallets.creditsCents,
      lifetimePurchasedCents: studentWallets.lifetimePurchasedCents,
    })
    .from(studentWallets)
    .where(eq(studentWallets.userId, user.id))
    .limit(1);

  const tutorName = { name: users.name };

  const upcoming = await db
    .select({
      id: bookings.id,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      ...tutorName,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.tutorId))
    .where(
      and(
        eq(bookings.studentId, user.id),
        gte(bookings.startAtUtc, now),
        inArray(bookings.status, ['pending_tutor', 'confirmed', 'in_progress']),
      ),
    )
    .orderBy(bookings.startAtUtc)
    .limit(10);

  const past = await db
    .select({
      id: bookings.id,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
      priceCents: bookings.priceCents,
      ...tutorName,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.tutorId))
    .where(and(eq(bookings.studentId, user.id), sql`${bookings.startAtUtc} < now()`))
    .orderBy(desc(bookings.startAtUtc))
    .limit(10);

  const [outgoingTrials, reviewable, trialToConvert] = await Promise.all([
    pendingTrialsForStudent(user.id, now),
    reviewableSessionsFor(user.id),
    recentTrialToConvert(user.id, now),
  ]);

  // SPEC.md §6: the conversion moment survives closing the tab. The slots are
  // real ones from the availability engine, loaded here so the card is useful
  // rather than decorative.
  let conversionSlots: ConversionSlot[] = [];
  if (trialToConvert) {
    const free = await getAvailability().freeSlotsFor({
      tutorId: trialToConvert.tutorId,
      durationMinutes: 60,
      toUtc: new Date(now.getTime() + 14 * 86_400_000),
      limit: 3,
    });
    if (free.known) {
      conversionSlots = free.value.slice(0, 3).map((slot) => ({
        startUtcIso: slot.startUtc.toISOString(),
        label: formatInTimeZone(slot.startUtc, user.timezone, {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
        }),
      }));
    }
  }

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 sm:px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hello, {user.name}</h1>
          <p className="text-sm text-muted-foreground">
            All times below are shown in {user.timezone}.
          </p>
        </div>

        {query.requested === 'trial' ? (
          <p role="status" className="rounded-md bg-[var(--success)]/10 px-4 py-3 text-sm">
            Trial requested. The tutor has 12 hours to accept — you will see it here either way, and nothing
            has been charged.
          </p>
        ) : null}

        {query.reviewed ? (
          <p role="status" className="rounded-md bg-[var(--success)]/10 px-4 py-3 text-sm">
            Thanks — your review is live on their profile.
          </p>
        ) : null}

        {trialToConvert ? (
          <TrialConversion
            tutorId={trialToConvert.tutorId}
            tutorName={trialToConvert.tutorName}
            hourlyCents={trialToConvert.hourlyCents}
            halfHourCents={trialToConvert.halfHourCents}
            slots={conversionSlots}
          />
        ) : null}

        <OutgoingTrials requests={outgoingTrials} timezone={user.timezone} now={now} />

        <ReviewPrompt
          sessions={reviewable}
          timezone={user.timezone}
          now={now}
          action={submitReview}
          error={query.reviewError ?? null}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Credit balance</CardDescription>
              <CardMetric className="text-3xl">{formatCents(wallet?.creditsCents ?? 0)}</CardMetric>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Credits never expire. Refunds come back as credits, not cash.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Bought all time</CardDescription>
              <CardMetric className="text-3xl">
                {formatCents(wallet?.lifetimePurchasedCents ?? 0)}
              </CardMetric>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Top-ups run through the mock payment provider until a real one is wired up.
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming sessions</CardTitle>
            <CardDescription>{upcoming.length} scheduled</CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing booked yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {upcoming.map((booking) => (
                  <li key={booking.id} className="flex flex-col gap-2 py-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p className="font-medium">{booking.name}</p>
                        <p className="text-muted-foreground">
                          {formatInTimeZone(booking.startAtUtc, user.timezone)} · {booking.durationMinutes} min
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {booking.isTrial ? <Badge variant="success">Free trial</Badge> : null}
                        <Badge variant="secondary">{booking.status}</Badge>
                        <span className="tabular-nums">{formatCents(booking.priceCents)}</span>
                        <JoinLink booking={booking} timezone={user.timezone} now={now} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {cancellationConsequence(booking, now)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {past.length === 0 ? (
              <p className="text-sm text-muted-foreground">No history yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {past.map((booking) => (
                  <li key={booking.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{booking.name}</p>
                      <p className="text-muted-foreground">
                        {formatInTimeZone(booking.startAtUtc, user.timezone)} · {booking.durationMinutes} min
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{booking.status}</Badge>
                      <span className="tabular-nums">{formatCents(booking.priceCents)}</span>
                    </div>
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
