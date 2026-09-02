/**
 * The student's dashboard: wallet balance, upcoming sessions, recent history.
 *
 * Every query is filtered by the session's user id. There is no route by which
 * a client can ask for another student's rows.
 */

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db/client';
import { bookings, studentWallets, users } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your dashboard' };

export default async function DashboardPage() {
  const user = await requireUser();

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
        gte(bookings.startAtUtc, new Date()),
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

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hello, {user.name}</h1>
          <p className="text-sm text-muted-foreground">
            All times below are shown in {user.timezone}.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Credit balance</CardDescription>
              <CardTitle className="text-3xl">{formatCents(wallet?.creditsCents ?? 0)}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Credits never expire. Refunds come back as credits, not cash.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Bought all time</CardDescription>
              <CardTitle className="text-3xl">
                {formatCents(wallet?.lifetimePurchasedCents ?? 0)}
              </CardTitle>
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
                  <li key={booking.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">{booking.name}</p>
                      <p className="text-muted-foreground">
                        {formatInTimeZone(booking.startAtUtc, user.timezone)} · {booking.durationMinutes} min
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {booking.isTrial ? <Badge variant="success">Free trial</Badge> : null}
                      <Badge variant="secondary">{booking.status}</Badge>
                      <span className="tabular-nums">{formatCents(booking.priceCents)}</span>
                    </div>
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
                  <li key={booking.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                    <div>
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
