/**
 * The student's dashboard: wallet balance, upcoming sessions, recent history.
 *
 * Every query is filtered by the session's user id. There is no route by which
 * a client can ask for another student's rows.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import Link from 'next/link';

import {
  answerRescheduleAction,
  cancelBookingAction,
  reportProblemAction,
  requestRescheduleAction,
  submitReview,
} from '@/app/dashboard/actions';
import { BookingActions, RescheduleInbox } from '@/components/bookings/booking-actions';
import { ReviewPrompt } from '@/components/reviews/review-prompt';
import { JoinLink } from '@/components/sessions/join-link';
import { OutgoingTrials } from '@/components/trials/outgoing-trials';
import { TrialConversion, type ConversionSlot } from '@/components/trials/trial-conversion';
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
import { bookings, studentWallets, users } from '@/db/schema';
import { openReschedulesFor } from '@/db/bookings';
import { getStudentCurriculum } from '@/db/curriculum';
import { loadStudentProfile } from '@/db/students';
import { ReminderPreference } from '@/components/students/reminders';
import { reviewableSessionsFor } from '@/db/reviews';
import { pendingTrialsForStudent, recentTrialToConvert } from '@/db/trials';
import { getAvailability } from '@/lib/availability';
import { sessionWindow } from '@/lib/sessions/window';
import { requireUser } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { cancellationConsequence } from '@/lib/sessions/cancellation';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your dashboard' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    reviewError?: string;
    reviewed?: string;
    requested?: string;
    booked?: string;
    cancelled?: string;
    moved?: string;
    declined?: string;
    reported?: string;
    credited?: string;
    reminders?: string;
    reminderError?: string;
    error?: string;
  }>;
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
      tutorId: bookings.tutorId,
      rescheduleCount: bookings.rescheduleCount,
      completedAt: bookings.completedAt,
      settledAt: bookings.settledAt,
      ...tutorName,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.tutorId))
    .where(
      and(
        eq(bookings.studentId, user.id),
        // Still to come, or happening right now — a session in progress is
        // where the join link lives, so it must not fall off this list the
        // moment it starts.
        sql`${bookings.startAtUtc} + make_interval(mins => ${bookings.durationMinutes}) >= now()`,
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
      isTrial: bookings.isTrial,
      rescheduleCount: bookings.rescheduleCount,
      completedAt: bookings.completedAt,
      settledAt: bookings.settledAt,
      ...tutorName,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.tutorId))
    .where(
      and(
        eq(bookings.studentId, user.id),
        // Finished, not merely started: a lesson happening right now is not
        // "recent", and offering to report a problem with it belongs upstairs.
        sql`${bookings.startAtUtc} + make_interval(mins => ${bookings.durationMinutes}) < now()`,
      ),
    )
    .orderBy(desc(bookings.startAtUtc))
    .limit(10);

  const [outgoingTrials, reviewable, trialToConvert, reschedules, studentPositions, student] =
    await Promise.all([
      pendingTrialsForStudent(user.id, now),
      reviewableSessionsFor(user.id),
      recentTrialToConvert(user.id, now),
      openReschedulesFor(user.id, now),
      getStudentCurriculum(user.id),
      loadStudentProfile(user.id),
    ]);

  // Times each upcoming session could move to. One engine call per distinct
  // tutor-and-duration rather than per booking, so a student with six sessions
  // with the same tutor costs one lookup — and every session on the page can be
  // moved, not just the first few.
  const calendars = new Map<string, Promise<Date[]>>();
  for (const booking of upcoming) {
    if (booking.isTrial) continue;
    const key = `${booking.tutorId}:${booking.durationMinutes}`;
    if (calendars.has(key)) continue;

    calendars.set(
      key,
      getAvailability()
        .freeSlotsFor({
          tutorId: booking.tutorId,
          durationMinutes: booking.durationMinutes,
          toUtc: new Date(now.getTime() + 14 * 86_400_000),
          limit: 8,
        })
        .then((free) => (free.known ? free.value.map((slot) => slot.startUtc) : [])),
    );
  }

  const resolved = new Map(
    await Promise.all(
      [...calendars.entries()].map(async ([key, slots]) => [key, await slots] as const),
    ),
  );

  const movableTo = new Map<string, Date[]>(
    upcoming
      .filter((booking) => !booking.isTrial)
      .map((booking) => [
        booking.id,
        resolved.get(`${booking.tutorId}:${booking.durationMinutes}`) ?? [],
      ]),
  );

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

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {query.booked ? (
          <p role="status" className="rounded-md bg-[var(--success)]/10 px-4 py-3 text-sm">
            Booked. Your credits are held in escrow until the session is over.
          </p>
        ) : null}

        {query.cancelled ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm">
            Cancelled. {formatCents(Number(query.cancelled))} went back to your balance.
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
          returnTo="/dashboard"
          action={answerRescheduleAction}
        />

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
            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>Credits never expire. Refunds come back as credits, not cash.</p>
              <Link href="/credits">
                <Button size="sm" variant="outline" className="min-h-11" data-testid="buy-credits">
                  Buy credits
                </Button>
              </Link>
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

        {upcoming.length > 0 || student?.phone ? (
          <ReminderPreference
            phone={student?.phone ?? null}
            returnTo="/dashboard"
            saved={query.reminders === '1'}
            error={query.reminderError === '1'}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>My classes</CardTitle>
            <CardDescription>
              {studentPositions.length === 0
                ? 'Tell us your exam board and class and the feed will show tutors who teach it first.'
                : studentPositions
                    .map((entry) => `${entry.boardName} · ${entry.levelName} · ${entry.subjectName}`)
                    .join(' — ')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/settings/curriculum">
              <Button size="sm" variant="outline" className="min-h-11" data-testid="manage-curriculum">
                {studentPositions.length === 0 ? 'Add my class' : 'Manage my classes'}
              </Button>
            </Link>
          </CardContent>
        </Card>

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
                  <li
                    key={booking.id}
                    data-testid="booking-row"
                    data-booking-id={booking.id}
                    className="flex flex-col gap-2 py-3 text-sm"
                  >
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
                    <BookingActions
                      booking={booking}
                      now={now}
                      timezone={user.timezone}
                      returnTo="/dashboard"
                      freeSlots={movableTo.get(booking.id) ?? []}
                      canReport={false}
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
                  <li key={booking.id} className="flex flex-col gap-2 py-3 text-sm">
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

                    <BookingActions
                      booking={booking}
                      now={now}
                      timezone={user.timezone}
                      returnTo="/dashboard"
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
      </main>
    </>
  );
}
