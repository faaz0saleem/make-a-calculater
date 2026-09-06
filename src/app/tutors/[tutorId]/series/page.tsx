/**
 * Setting up a standing arrangement (SPEC.md §5, DECISIONS_NEEDED item 32).
 *
 * The market this is for sells a month — "three sessions a week, 50,000 a
 * month" — so this page is one decision rather than eight bookings. What it
 * deliberately does not do is take a month's money: the sticker below says what
 * four weeks will cost and then says, in the same breath, that none of it is
 * taken today. Everything is charged 48 hours before its own session.
 *
 * The time is shown in the **tutor's** timezone because that is what the slot
 * is anchored to — their published hours do not move, so neither does the
 * arrangement. The student's own time is shown beside it, since across a
 * five-hour offset those are different evenings.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { startSeries } from '@/app/tutors/[tutorId]/series/actions';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/select';
import { db } from '@/db/client';
import { seriesFor } from '@/db/series';
import { subjects } from '@/db/schema';
import { loadTutorDossier } from '@/db/tutors';
import { requireUser } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { priceForBooking } from '@/lib/money/pricing';
import { WEEKDAY_NAMES } from '@/lib/series/occurrences';
import { MATERIALISE_DAYS, monthlyCommitmentCents, SERIES_DURATIONS } from '@/lib/series/rules';
import { bookabilityProblem } from '@/lib/tutors/visibility';
import { inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'A standing slot' };

export default async function SeriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tutorId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ tutorId }, query, user] = await Promise.all([params, searchParams, requireUser()]);

  const tutor = await loadTutorDossier(tutorId);
  if (!tutor) notFound();
  if (bookabilityProblem(tutor)) notFound();

  const existing = (await seriesFor(user.id, 'student')).find((row) => row.tutorId === tutorId);

  const subjectRows =
    tutor.subjects.length > 0
      ? await db
          .select({ id: subjects.id, name: subjects.name })
          .from(subjects)
          .where(inArray(subjects.slug, tutor.subjects.map((subject) => subject.slug)))
      : [];

  const { priceCents } = priceForBooking({
    rates: {
      hourlyCents: tutor.hourlyCents,
      halfHourCents: tutor.halfHourCents,
      promoCents: tutor.promoCents,
      promoStartsAt: tutor.promoStartsAt,
      promoEndsAt: tutor.promoEndsAt,
    },
    durationMinutes: 60,
    isTrial: false,
    now: new Date(),
  });

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            A standing slot with {tutor.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Same time every week, booked once. Times are {tutor.timezone}, which is where{' '}
            {tutor.name.split(' ')[0]} is.
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {existing ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-5 text-sm">
              <p>You already have a standing arrangement with {tutor.name}.</p>
              <Link href="/dashboard">
                <Button size="sm" variant="outline">
                  See it on your dashboard
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle as="h2">When</CardTitle>
              <CardDescription>
                We check every week for the next {MATERIALISE_DAYS / 7} weeks before booking anything.
                If one of them clashes we will say which.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form action={startSeries.bind(null, tutorId)} className="flex flex-col gap-5">
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium">Which days</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAY_NAMES.map((name, index) => (
                      <label
                        key={name}
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          name="weekdays"
                          value={index}
                          className="h-4 w-4 accent-[var(--primary)]"
                          data-testid={`weekday-${index}`}
                        />
                        {name.slice(0, 3)}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="What time"
                    htmlFor="startTimeLocal"
                    hint={`In ${tutor.timezone}.`}
                  >
                    <input
                      id="startTimeLocal"
                      name="startTimeLocal"
                      type="time"
                      step={1800}
                      required
                      defaultValue="18:00"
                      className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="series-time"
                    />
                  </Field>

                  <Field label="How long" htmlFor="durationMinutes">
                    <select
                      id="durationMinutes"
                      name="durationMinutes"
                      defaultValue={60}
                      className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {SERIES_DURATIONS.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} minutes
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {subjectRows.length > 0 ? (
                  <Field label="Which subject" htmlFor="subjectId" hint="Optional.">
                    <select
                      id="subjectId"
                      name="subjectId"
                      className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Not set</option>
                      {subjectRows.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                <div className="rounded-md bg-secondary px-4 py-3 text-sm">
                  <p className="font-medium">
                    {formatCents(priceCents)} a session — around{' '}
                    {formatCents(monthlyCommitmentCents(priceCents, 2))} a month at twice a week.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong>None of that is taken today.</strong> Each session is charged from your
                    credits 48 hours before it happens, and we warn you a day earlier if your balance
                    will not cover the next one. You can cancel a single week without ending the
                    arrangement, and either of you can end it with seven days&rsquo; notice.
                  </p>
                </div>

                <Button type="submit" size="lg" className="min-h-11 self-start" data-testid="start-series">
                  Set up the standing slot
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Link
          href={`/tutors/${tutorId}`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Back to {tutor.name}
        </Link>
      </main>
    </>
  );
}
