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

import { askForTrial, toggleFollow } from '@/app/tutors/[tutorId]/actions';
import { BookingCalendar, type CalendarMode } from '@/components/booking/calendar';
import { FollowButton } from '@/components/tutors/follow-button';
import { ReviewList } from '@/components/reviews/review-list';
import { SiteHeader } from '@/components/site-header';
import { TimezoneProbe, TIMEZONE_COOKIE } from '@/components/timezone-probe';
import { IntroPlayer } from '@/components/video/intro-player';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isFollowing, followerCount } from '@/db/follows';
import { ratingSummaryFor, reviewsForTutor } from '@/db/reviews';
import { pairHasHadTrial } from '@/db/trials';
import { loadTutorDossier } from '@/db/tutors';
import { currentUser } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { formatStars } from '@/lib/reviews/rules';
import { languageName, PROFICIENCY_LABELS, type LanguageProficiency } from '@/lib/tutors/languages';
import { getAvailability } from '@/lib/availability';
import { priceForBooking } from '@/lib/money/pricing';
import { describeResponseTime } from '@/lib/messaging/response-time';
import { TRIAL_BUFFER_MINUTES } from '@/lib/trials/rules';
import { isValidTimeZone } from '@/lib/time';
import { bookabilityProblem, canViewProfile, isPubliclyVisible } from '@/lib/tutors/visibility';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function TutorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ tutorId: string }>;
  searchParams: Promise<{ mode?: string; duration?: string; error?: string }>;
}) {
  const { tutorId } = await params;
  const [tutor, viewer, jar, query] = await Promise.all([
    loadTutorDossier(tutorId),
    currentUser(),
    cookies(),
    searchParams,
  ]);

  if (!tutor) notFound();
  if (!canViewProfile(tutor.id, tutor, viewer)) notFound();

  const isPreview = !isPubliclyVisible(tutor);
  const problem = bookabilityProblem(tutor);

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
        toUtc: new Date(Date.now() + 14 * 86_400_000),
        limit: 120,
      });

  const respondsIn = describeResponseTime(tutor.responseMedianSeconds ?? null);

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

        <BookingCalendar
          slots={slots && slots.known ? slots.value : null}
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
            mode === 'trial' && viewer
              ? {
                  action: askForTrial.bind(null, tutor.id),
                  label: `Ask for a free ${tutor.trialMinutes}-minute trial`,
                  note: `Pick a time and ${tutor.name.split(' ')[0]} has 12 hours to accept. Nothing is charged, and you keep your credits either way.`,
                }
              : undefined
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
                : alreadyTrialled
                  ? 'You have already had your free trial with this tutor.'
                  : 'Pick a slot above. Paying with credits arrives with booking.'}
          </p>

          {trialOffered && viewer ? (
            <Link href={`/tutors/${tutor.id}?mode=trial`}>
              <Button className="min-h-11">Book free trial</Button>
            </Link>
          ) : trialOffered && !viewer ? (
            <Link href={`/signin?next=${encodeURIComponent(`/tutors/${tutor.id}?mode=trial`)}`}>
              <Button className="min-h-11">Sign in to book a free trial</Button>
            </Link>
          ) : (
            <Button disabled title="Paying with credits arrives with booking" className="min-h-11">
              Book session
            </Button>
          )}
        </div>

        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to all tutors
        </Link>
      </main>
    </>
  );
}
