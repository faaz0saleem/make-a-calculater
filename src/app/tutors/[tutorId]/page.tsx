/**
 * A tutor's public profile (SPEC.md §4).
 *
 * Phase 1 shows the claims and the verified qualifications — institution and
 * year, never the document. The video hero, the review breakdown and the
 * booking calendar arrive with phases 2 and 3.
 *
 * An unverified tutor 404s here for everyone except that tutor (previewing
 * their own profile) and admins. Not 403: a 403 would confirm the account
 * exists (SPEC.md §16, last line).
 */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { askForTrial, bookSession, dropHold, toggleFollow } from '@/app/tutors/[tutorId]/actions';
import { BookingCalendar, type CalendarMode } from '@/components/booking/calendar';
import { FollowButton } from '@/components/tutors/follow-button';
import { ReviewList } from '@/components/reviews/review-list';
import { ReportForm } from '@/components/reports/report-form';
import { SiteHeader } from '@/components/site-header';
import { TimezoneProbe, TIMEZONE_COOKIE } from '@/components/timezone-probe';
import { IntroPlayer } from '@/components/video/intro-player';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { guestHoldFor, heldSlotsFor, liveHoldsFor } from '@/db/bookings';
import { isFollowing, followerCount } from '@/db/follows';
import { ratingSummaryFor, reviewsForTutor } from '@/db/reviews';
import { pairHasHadTrial } from '@/db/trials';
import { getStudentCurriculum, getTutorCurriculum, toPosition } from '@/db/curriculum';
import { loadTutorDossier } from '@/db/tutors';
import { currentUser } from '@/lib/auth/guards';
import { readGuestToken } from '@/lib/bookings/guest';
import { formatCents } from '@/lib/money/cents';
import { formatStars } from '@/lib/reviews/rules';
import { languageName, PROFICIENCY_LABELS, type LanguageProficiency } from '@/lib/tutors/languages';
import { getAvailability } from '@/lib/availability';
import { priceForBooking } from '@/lib/money/pricing';
import { describeHold } from '@/lib/bookings/holds';
import { describeResponseTime } from '@/lib/messaging/response-time';
import { TRIAL_BUFFER_MINUTES, TRIAL_CUTOFF_MINUTES_BEFORE_START } from '@/lib/trials/rules';
import { formatInTimeZone, isValidTimeZone } from '@/lib/time';
import { bookabilityProblem, canViewProfile, isPubliclyVisible } from '@/lib/tutors/visibility';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function TutorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ tutorId: string }>;
  searchParams: Promise<{
    mode?: string;
    duration?: string;
    error?: string;
    at?: string;
    reported?: string;
  }>;
}) {
  const { tutorId } = await params;
  const [tutor, viewer, jar, query, positions] = await Promise.all([
    loadTutorDossier(tutorId),
    currentUser(),
    cookies(),
    searchParams,
    getTutorCurriculum(tutorId),
  ]);

  if (!tutor) notFound();
  if (!canViewProfile(tutor.id, tutor, viewer)) notFound();

  const isPreview = !isPubliclyVisible(tutor);
  const problem = bookabilityProblem(tutor);

  // Which of this tutor's positions are the viewer's own, so the profile can
  // say "this is your class" rather than leaving them to compare two lists.
  const viewerPositions = viewer ? (await getStudentCurriculum(viewer.id)).map(toPosition) : [];
  const viewerLevels = new Set(
    viewerPositions.map((position) => `${position.levelId}:${position.subjectId}`),
  );

  // The viewer's timezone: their account if they have one, the cookie the
  // browser set otherwise, and UTC only if neither is available.
  const cookieTimezone = jar.get(TIMEZONE_COOKIE)?.value;
  const studentTimezone =
    viewer?.timezone ??
    (cookieTimezone && isValidTimeZone(cookieTimezone) ? cookieTimezone : null) ??
    'UTC';

  // Who this viewer is to this tutor decides what the calendar offers.
  const [alreadyTrialled, following, followers, ratings, reviews] = await Promise.all([
    viewer ? pairHasHadTrial(viewer.id, tutor.id) : Promise.resolve(false),
    viewer ? isFollowing(viewer.id, tutor.id) : Promise.resolve(false),
    followerCount(tutor.id),
    ratingSummaryFor(tutor.id),
    reviewsForTutor(tutor.id),
  ]);

  const trialOffered = tutor.offersTrial && !problem && !alreadyTrialled && viewer?.id !== tutor.id;
  const requested = query.mode ?? query.duration;
  const mode: CalendarMode = requested === 'trial' && trialOffered ? 'trial' : requested === '30' ? 30 : 60;

  const durationMinutes = mode === 'trial' ? tutor.trialMinutes : mode;
  const { priceCents } = priceForBooking({
    rates: {
      hourlyCents: tutor.hourlyCents,
      halfHourCents: tutor.halfHourCents,
      promoCents: tutor.promoCents,
      promoStartsAt: tutor.promoStartsAt,
      promoEndsAt: tutor.promoEndsAt,
    },
    durationMinutes: mode === 'trial' ? 30 : mode,
    isTrial: mode === 'trial',
    now: new Date(),
  });

  // Two weeks is enough to choose from without rendering a month of buttons. A
  // trial asks for its own length plus the buffer that follows it (SPEC.md §6),
  // so a 15-minute trial can sit in a gap an hour-long session could not.
  const slots = problem
    ? null
    : await getAvailability().freeSlotsFor({
        tutorId: tutor.id,
        durationMinutes: mode === 'trial' ? durationMinutes + TRIAL_BUFFER_MINUTES : durationMinutes,
        // A trial needs the tutor's answer before it starts, so a slot inside
        // the cutoff is one the request would refuse. Offering it and then
        // refusing it is a worse experience than not offering it (SPEC.md §6).
        fromUtc:
          mode === 'trial'
            ? new Date(Date.now() + TRIAL_CUTOFF_MINUTES_BEFORE_START * 60_000)
            : undefined,
        toUtc: new Date(Date.now() + 14 * 86_400_000),
        limit: 120,
      });

  const respondsIn = describeResponseTime(tutor.responseMedianSeconds ?? null);

  // Slots somebody else is holding while they buy credits are not offered; the
  // student's own hold is, and is called out above the calendar.
  const now = new Date();
  // A visitor with no account can hold a slot too, so their own hold has to be
  // excluded from "somebody else has this" the same way a member's is.
  const guestToken = viewer ? null : await readGuestToken();
  const [othersHolding, myHolds, guestHold] = await Promise.all([
    heldSlotsFor(tutor.id, viewer?.id ?? null, now, undefined, guestToken),
    viewer ? liveHoldsFor(viewer.id, now) : Promise.resolve([]),
    guestToken ? guestHoldFor(guestToken, tutor.id, now) : Promise.resolve(null),
  ]);

  const heldElsewhere = new Set(othersHolding.map((slot) => slot.getTime()));
  const myHold =
    myHolds.find((hold) => hold.tutorId === tutor.id) ??
    (guestHold ? { ...guestHold, tutorId: tutor.id, tutorName: tutor.name } : null);

  const offered =
    slots && slots.known
      ? slots.value.filter((slot) => !heldElsewhere.has(slot.startUtc.getTime()))
      : null;

  return (
    <>
      <SiteHeader />
      <TimezoneProbe current={cookieTimezone ?? null} />

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 sm:px-6 py-10">
        {isPreview ? (
          <p className="rounded-md bg-secondary px-3 py-2 text-sm">
            Preview — this profile is <strong>{tutor.status}</strong>, so nobody else can see it and it
            cannot be booked.
          </p>
        ) : null}

        <header className="flex flex-wrap items-start gap-4">
          {tutor.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tutor.avatarUrl} alt="" className="size-16 rounded-full border border-border object-cover" />
          ) : (
            <span className="size-16 rounded-full bg-secondary" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{tutor.name}</h1>
              {tutor.status === 'verified' ? <Badge variant="success">Verified</Badge> : null}
              {tutor.offersTrial ? <Badge variant="secondary">Free trial</Badge> : null}
            </div>
            <p className="text-muted-foreground">{tutor.headline}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {[tutor.city, tutor.country].filter(Boolean).join(', ')} · {tutor.timezone}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>
                <span aria-hidden>★</span>{' '}
                <span className="font-medium text-foreground">{formatStars(ratings.displayedMilli)}</span>{' '}
                {ratings.count === 0
                  ? '(no reviews yet)'
                  : `(${ratings.count} review${ratings.count === 1 ? '' : 's'})`}
              </span>
              {respondsIn ? <span>{respondsIn}</span> : null}
              {followers > 0 ? (
                <span>
                  {followers} follower{followers === 1 ? '' : 's'}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="text-right">
              <p className="text-xl font-semibold">
                {formatCents(tutor.hourlyCents)}
                <span className="text-sm font-normal text-muted-foreground">/hr</span>
              </p>
              <p className="text-sm text-muted-foreground">{formatCents(tutor.halfHourCents)} per 30 min</p>
            </div>
            {viewer && viewer.id !== tutor.id ? (
              <FollowButton
                following={following}
                action={toggleFollow.bind(null, tutor.id)}
                tutorName={tutor.name}
              />
            ) : null}
          </div>
        </header>

        <IntroPlayer
          heroUrl={tutor.video?.heroUrl ?? null}
          previewUrl={tutor.video?.previewUrl ?? null}
          posterUrl={tutor.video?.thumbnailUrl ?? null}
          name={tutor.name}
        />

        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{tutor.bio}</p>
          </CardContent>
        </Card>

        {positions.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Boards and classes</CardTitle>
              <CardDescription>
                The syllabus matters as much as the subject, so this is what {tutor.name.split(' ')[0]}{' '}
                actually teaches.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-2">
                {positions.map((position) => {
                  const mine = viewerLevels.has(`${position.levelId}:${position.subjectId}`);
                  return (
                    <li key={`${position.boardId}:${position.levelId}:${position.subjectId}`}>
                      <Badge variant={mine ? 'success' : 'secondary'} data-testid="tutor-position">
                        {position.boardName} · {position.levelName} · {position.subjectName}
                        {mine ? ' — your class' : ''}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Subjects</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                {tutor.subjects.map((subject) => (
                  <li key={subject.name} className="flex items-center justify-between">
                    <span>{subject.name}</span>
                    <span className="text-muted-foreground">
                      {subject.level.replace('_', ' ')} · {subject.yearsExperience} yr
                    </span>
                  </li>
                ))}
              </ul>
              {tutor.languages.length > 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Teaches in{' '}
                  {tutor.languages
                    .map(
                      (language) =>
                        `${languageName(language.languageCode)} (${
                          PROFICIENCY_LABELS[language.proficiency as LanguageProficiency] ?? language.proficiency
                        })`,
                    )
                    .join(', ')}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Qualifications</CardTitle>
              <CardDescription>
                Verified by our review team. We show the institution and the year — never the document
                itself.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tutor.credentials.filter((document) => document.status === 'approved').length === 0 ? (
                <p className="text-sm text-muted-foreground">None verified yet.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {tutor.credentials
                    .filter((document) => document.status === 'approved')
                    .map((document) => (
                      <li key={document.id}>
                        {document.title} — {document.institution}
                        {document.year ? `, ${document.year}` : ''}
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <ReviewList summary={ratings} reviews={reviews} timezone={studentTimezone} />

        {myHold && mode !== 'trial' ? (
          <div
            role="status"
            data-testid="slot-hold"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary bg-card px-4 py-3 text-sm"
          >
            <p>
              <strong>
                {formatInTimeZone(myHold.startAtUtc, studentTimezone, {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </strong>{' '}
              is held for you — {describeHold(myHold, now)}. Nobody else can take it until then.
            </p>
            <form action={dropHold.bind(null, tutor.id)}>
              <input type="hidden" name="startUtc" value={myHold.startAtUtc.toISOString()} />
              <Button type="submit" variant="ghost" size="sm" className="min-h-11">
                Give it up
              </Button>
            </form>
          </div>
        ) : null}

        <BookingCalendar
          slots={offered}
          studentTimezone={studentTimezone}
          tutorTimezone={tutor.timezone}
          mode={mode}
          priceCents={priceCents}
          durationMinutes={durationMinutes}
          modeHref={(next) => `/tutors/${tutor.id}?mode=${next}`}
          trialMinutes={trialOffered ? tutor.trialMinutes : null}
          bookable={!problem}
          notBookableReason={
            problem === 'suspended'
              ? 'This tutor is not currently taking bookings.'
              : 'This tutor has not completed verification yet, so they cannot be booked.'
          }
          error={query.error ?? null}
          select={
            problem
              ? undefined
              : mode === 'trial' && !viewer
                ? {
                    // A trial needs an account before it means anything — a
                    // tutor is being asked to give up real time.
                    action: bookSession.bind(null, tutor.id, 60),
                    label: 'Sign up to ask for a free trial',
                    note: 'Picking a time holds it for ten minutes while you create an account.',
                  }
                : mode === 'trial'
                ? {
                    action: askForTrial.bind(null, tutor.id),
                    label: `Ask for a free ${tutor.trialMinutes}-minute trial`,
                    note: `Pick a time and ${tutor.name.split(' ')[0]} has 12 hours to accept. Nothing is charged, and you keep your credits either way.`,
                  }
                  : {
                      action: bookSession.bind(null, tutor.id, mode),
                      label: `Choose ${mode} minutes — ${formatCents(priceCents)}`,
                      note: viewer
                        ? `Pressing a time holds it for ten minutes. Nothing is charged until you confirm on the next page.`
                        : `Pressing a time holds it for ten minutes while you create an account. Nothing is charged until you confirm.`,
                    }
          }
        />

        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {problem
              ? problem === 'suspended'
                ? 'This tutor is not currently taking bookings.'
                : 'This tutor has not completed verification yet, so they cannot be booked.'
              : trialOffered
                ? `A free ${tutor.trialMinutes}-minute trial, no credits, no card.`
                : `${alreadyTrialled ? 'You have already had your free trial with this tutor. ' : ''}${formatCents(priceCents)} for ${durationMinutes} minutes, paid from your credits.`}
          </p>

          {problem ? (
            // A profile that cannot be booked does not offer a button that
            // looks like it can.
            <Button disabled className="min-h-11">
              Book a session
            </Button>
          ) : trialOffered ? (
            <Link href={`/tutors/${tutor.id}?mode=trial`}>
              <Button className="min-h-11">Book free trial</Button>
            </Link>
          ) : (
            <Link href={`/tutors/${tutor.id}?mode=60`}>
              <Button className="min-h-11">Book a session</Button>
            </Link>
          )}

          {!problem && viewer && viewer.id !== tutor.id ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Studying with {tutor.name.split(' ')[0]} every week?{' '}
              <Link
                href={`/tutors/${tutor.id}/series`}
                className="underline underline-offset-4"
                data-testid="standing-slot-link"
              >
                Set up a standing slot
              </Link>{' '}
              — booked once, and nothing is paid up front.
            </p>
          ) : null}
        </div>

        {query.reported ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm" data-testid="reported">
            Thanks. Somebody will read it, and we have not told them who reported it.
          </p>
        ) : null}

        {viewer && viewer.id !== tutor.id ? (
          <ReportForm
            targetType="tutor_profile"
            targetId={tutor.id}
            returnTo={`/tutors/${tutor.id}`}
            label={tutor.name ?? 'this tutor'}
            summary="Report this tutor"
          />
        ) : null}

        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to all tutors
        </Link>
      </main>
    </>
  );
}
