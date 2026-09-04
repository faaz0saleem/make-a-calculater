/**
 * The classroom (SPEC.md §7).
 *
 * Authorisation and every fact about the session are resolved here, on the
 * server. The client gets a booking id, the schedule, and who the other person
 * is — never a token it could have asked for itself.
 */

import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { Classroom } from '@/components/classroom/classroom';
import { db } from '@/db/client';
import { bookings, users } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { isLiveKitConfigured } from '@/lib/livekit/config';
import { sessionWindow } from '@/lib/sessions/window';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Session' };

export default async function SessionPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const user = await requireUser();

  const [booking] = await db
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      studentName: users.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.studentId))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  // A 404 rather than a 403, so this cannot be used to find out that somebody
  // else's session exists (SPEC.md §16).
  if (!booking) notFound();
  if (booking.studentId !== user.id && booking.tutorId !== user.id) notFound();

  const isTutor = booking.tutorId === user.id;

  const [other] = await db
    .select({ name: users.name, image: users.image })
    .from(users)
    .where(eq(users.id, isTutor ? booking.studentId : booking.tutorId))
    .limit(1);

  const window = sessionWindow(booking.startAtUtc, booking.durationMinutes);

  return (
    <Classroom
      bookingId={booking.id}
      role={isTutor ? 'tutor' : 'student'}
      otherName={other?.name ?? 'Your tutor'}
      otherAvatarUrl={other?.image ?? null}
      viewerName={user.name}
      viewerTimezone={user.timezone}
      isTrial={booking.isTrial}
      priceCents={booking.priceCents}
      status={booking.status}
      startUtcIso={window.startUtc.toISOString()}
      endUtcIso={window.endUtc.toISOString()}
      joinOpensUtcIso={window.joinOpensUtc.toISOString()}
      joinClosesUtcIso={window.joinClosesUtc.toISOString()}
      configured={isLiveKitConfigured()}
    />
  );
}
