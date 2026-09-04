/**
 * Committing to a booking — the one page that asks for money.
 *
 * The paywall used to be the first thing a visitor met: buy credits, then find
 * a tutor. That asks somebody to pay before we have shown them anything worth
 * paying for. It now sits here, at the end: they have browsed, opened a
 * profile, seen a price, chosen a person and a time, and the slot is held.
 * That is the moment somebody is motivated to finish, and the moment it is
 * fair to ask.
 *
 * Everything the commit needs is on this page and nothing leaves it: the
 * balance, the shortfall, the top-up, the name the tutor will see, and — for
 * an account that told us it is under 18 — a guardian's email. A detour to a
 * separate credits page is how a booking gets abandoned.
 *
 * Signed out, the slot pick is what sends somebody to sign up; the hold made
 * on the way out is claimed on the way back in, so they land here on the same
 * slot rather than on the home page.
 */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { confirmBooking, dropHold } from '@/app/tutors/[tutorId]/actions';
import { TopUp } from '@/components/credits/top-up';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/select';
import { db } from '@/db/client';
import { liveHoldsFor } from '@/db/bookings';
import { packsForUser } from '@/db/purchases';
import { studentWallets } from '@/db/schema';
import { loadStudentProfile } from '@/db/students';
import { loadTutorDossier } from '@/db/tutors';
import { currentUser } from '@/lib/auth/guards';
import { TIMEZONE_COOKIE } from '@/components/timezone-probe';
import { formatCents } from '@/lib/money/cents';
import { priceForBooking } from '@/lib/money/pricing';
import { methodsForCountry } from '@/lib/payments';
import { formatInTimeZone, isValidTimeZone } from '@/lib/time';
import { bookabilityProblem } from '@/lib/tutors/visibility';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirm your booking' };

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ tutorId: string }>;
  searchParams: Promise<{ mode?: string; at?: string; short?: string; error?: string }>;
}) {
  const [{ tutorId }, query, viewer, jar] = await Promise.all([
    params,
    searchParams,
    currentUser(),
    cookies(),
  ]);

  const durationMinutes = query.mode === '30' ? 30 : 60;
  const startAtUtc = new Date(String(query.at ?? ''));
  if (Number.isNaN(startAtUtc.getTime())) redirect(`/tutors/${tutorId}`);

  // Signed out here means somebody arrived by link rather than by pressing a
  // slot. Send them to sign up *with this page as the destination*, so they
  // come back to the same lesson rather than to a dashboard.
  if (!viewer) {
    const here = `/tutors/${tutorId}/book?mode=${durationMinutes}&at=${encodeURIComponent(
      startAtUtc.toISOString(),
    )}`;
    redirect(`/signup?next=${encodeURIComponent(here)}`);
  }

  const user = viewer;

  const tutor = await loadTutorDossier(tutorId);
  if (!tutor) notFound();
  if (bookabilityProblem(tutor)) redirect(`/tutors/${tutorId}`);

  const cookieTimezone = jar.get(TIMEZONE_COOKIE)?.value;
  const timezone =
    user.timezone ??
    (cookieTimezone && isValidTimeZone(cookieTimezone) ? cookieTimezone : null) ??
    'UTC';

  const [profile, wallet, packs, holds] = await Promise.all([
    loadStudentProfile(user.id),
    db
      .select({ creditsCents: studentWallets.creditsCents })
      .from(studentWallets)
      .where(eq(studentWallets.userId, user.id))
      .limit(1),
    packsForUser(user.id),
    liveHoldsFor(user.id),
  ]);

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

  const balance = wallet[0]?.creditsCents ?? 0;
  const shortfall = Math.max(priceCents - balance, 0);
  const hold = holds.find(
    (entry) => entry.tutorId === tutorId && entry.startAtUtc.getTime() === startAtUtc.getTime(),
  );

  // Under 18 and no guardian on file yet. This is the moment it stops being
  // hypothetical: somebody is about to meet an adult on a video call.
  const needsGuardian = profile?.isAdult === false && !profile.guardianLinked;
  const needsName = !profile?.nameConfirmed;
  const methods = methodsForCountry(profile?.country);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Confirm your booking</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing is charged until you press the button below.
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">
              {durationMinutes} minutes with {tutor.name}
            </CardTitle>
            <CardDescription data-testid="booking-when">
              {formatInTimeZone(startAtUtc, timezone, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: 'numeric',
                minute: '2-digit',
              })}{' '}
              — your time ({timezone})
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Price</span>
              <span className="font-medium tabular-nums" data-testid="booking-price">
                {formatCents(priceCents)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Your credits</span>
              <span className="tabular-nums" data-testid="booking-balance">
                {formatCents(balance)}
              </span>
            </div>

            {hold ? (
              <p className="rounded-md bg-secondary px-3 py-2 text-xs" data-testid="hold-notice">
                This time is held for you until{' '}
                {formatInTimeZone(hold.expiresAt, timezone, { timeStyle: 'short' })}. Nobody else can
                take it before then.
              </p>
            ) : (
              <p className="rounded-md bg-secondary px-3 py-2 text-xs">
                This time is not held. Somebody else could take it while you finish.
              </p>
            )}
          </CardContent>
        </Card>

        {shortfall > 0 ? (
          <Card data-testid="inline-top-up">
            <CardHeader>
              <CardTitle as="h2">
                You need {formatCents(shortfall)} more <Badge variant="secondary">Top up here</Badge>
              </CardTitle>
              <CardDescription>
                Buy credits without leaving this page. Your slot stays held while you do.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TopUp
                packs={packs}
                methods={methods}
                shortfallCents={shortfall}
                returnTo={`/tutors/${tutorId}/book?mode=${durationMinutes}&at=${encodeURIComponent(
                  startAtUtc.toISOString(),
                )}`}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">Book it</CardTitle>
            <CardDescription>
              {formatCents(priceCents)} moves from your credits into escrow and stays there until the
              session is over. Cancel more than 24 hours before and you get all of it back.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form action={confirmBooking.bind(null, tutorId, durationMinutes)} className="flex flex-col gap-4">
              <input type="hidden" name="startUtc" value={startAtUtc.toISOString()} />

              {needsName ? (
                <Field
                  label="What should we call you?"
                  htmlFor="name"
                  hint={`${tutor.name.split(' ')[0]} will see this when the session appears in their calendar.`}
                >
                  <Input
                    id="name"
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={profile?.name ?? ''}
                    autoComplete="name"
                  />
                </Field>
              ) : null}

              {needsGuardian ? (
                <Field
                  label="A parent or guardian’s email"
                  htmlFor="guardianEmail"
                  hint="You told us you are under 18, so we need an adult on file before your first lesson. We will write to them about this booking."
                >
                  <Input
                    id="guardianEmail"
                    name="guardianEmail"
                    type="email"
                    required
                    maxLength={255}
                    autoComplete="email"
                    data-testid="guardian-email"
                  />
                </Field>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="min-h-11"
                disabled={shortfall > 0}
                data-testid="confirm-booking"
              >
                {shortfall > 0
                  ? `Top up ${formatCents(shortfall)} to book`
                  : `Book and hold ${formatCents(priceCents)}`}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/tutors/${tutorId}?mode=${durationMinutes}`}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            Pick a different time
          </Link>

          {hold ? (
            <form action={dropHold.bind(null, tutorId)}>
              <input type="hidden" name="startUtc" value={startAtUtc.toISOString()} />
              <Button type="submit" variant="outline" size="sm">
                Give up this time
              </Button>
            </form>
          ) : null}
        </div>
      </main>
    </>
  );
}
