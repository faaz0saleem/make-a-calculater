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

import { BookingCalendar } from '@/components/booking/calendar';
import { SiteHeader } from '@/components/site-header';
import { TimezoneProbe, TIMEZONE_COOKIE } from '@/components/timezone-probe';
import { IntroPlayer } from '@/components/video/intro-player';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loadTutorDossier } from '@/db/tutors';
import { currentUser } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { languageName, PROFICIENCY_LABELS, type LanguageProficiency } from '@/lib/tutors/languages';
import { getAvailability } from '@/lib/availability';
import { priceForBooking } from '@/lib/money/pricing';
import { isValidTimeZone } from '@/lib/time';
import { bookabilityProblem, canViewProfile, isPubliclyVisible } from '@/lib/tutors/visibility';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function TutorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ tutorId: string }>;
  searchParams: Promise<{ duration?: string }>;
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

  const durationMinutes = query.duration === '30' ? 30 : 60;
  const { priceCents } = priceForBooking({
    rates: {
      hourlyCents: tutor.hourlyCents,
      halfHourCents: tutor.halfHourCents,
      promoCents: tutor.promoCents,
      promoStartsAt: tutor.promoStartsAt,
      promoEndsAt: tutor.promoEndsAt,
    },
    durationMinutes,
    isTrial: false,
    now: new Date(),
  });

  // Two weeks is enough to choose from without rendering a month of buttons.
  const slots = problem
    ? null
    : await getAvailability().freeSlotsFor({
        tutorId: tutor.id,
        durationMinutes,
        toUtc: new Date(Date.now() + 14 * 86_400_000),
        limit: 120,
      });

  return (
    <>
      <SiteHeader />
      <TimezoneProbe current={cookieTimezone ?? null} />

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
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
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold">
              {formatCents(tutor.hourlyCents)}
              <span className="text-sm font-normal text-muted-foreground">/hr</span>
            </p>
            <p className="text-sm text-muted-foreground">{formatCents(tutor.halfHourCents)} per 30 min</p>
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

        <BookingCalendar
          slots={slots && slots.known ? slots.value : null}
          studentTimezone={studentTimezone}
          tutorTimezone={tutor.timezone}
          durationMinutes={durationMinutes}
          priceCents={priceCents}
          durationHref={(minutes) => `/tutors/${tutor.id}?duration=${minutes}`}
          bookable={!problem}
          notBookableReason={
            problem === 'suspended'
              ? 'This tutor is not currently taking bookings.'
              : 'This tutor has not completed verification yet, so they cannot be booked.'
          }
        />

        <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {problem
              ? problem === 'suspended'
                ? 'This tutor is not currently taking bookings.'
                : 'This tutor has not completed verification yet, so they cannot be booked.'
              : 'Pick a slot above. Paying with credits arrives with booking.'}
          </p>
          <Button disabled title="Booking arrives with credits">
            {tutor.offersTrial && !problem ? 'Book free trial' : 'Book session'}
          </Button>
        </div>

        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to all tutors
        </Link>
      </main>
    </>
  );
}
