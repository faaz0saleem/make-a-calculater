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
import type { ConversionSlot } from '@/components/trials/trial-conversion';
import { db } from '@/db/client';
import { bookings, tutorProfiles, users } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { getAvailability } from '@/lib/availability';
import { isLiveKitConfigured } from '@/lib/livekit/config';
import { sessionWindow } from '@/lib/sessions/window';
import { formatInTimeZone } from '@/lib/time';

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
      hourlyCents: tutorProfiles.hourlyCents,
      halfHourCents: tutorProfiles.halfHourCents,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.studentId))
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, bookings.tutorId))
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

  // SPEC.md §6: the moment a trial ends is the conversion moment, so the
  // tutor's next three genuinely free hours are loaded before the student needs
  // them — not fetched after they have already closed the tab.
  let conversionSlots: ConversionSlot[] = [];
  if (booking.isTrial && !isTutor) {
    const free = await getAvailability().freeSlotsFor({
      tutorId: booking.tutorId,
      durationMinutes: 60,
      fromUtc: window.endUtc,
      toUtc: new Date(window.endUtc.getTime() + 14 * 86_400_000),
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
      conversion={
        booking.isTrial && !isTutor
          ? {
              tutorId: booking.tutorId,
              tutorName: other?.name ?? 'your tutor',
              hourlyCents: booking.hourlyCents,
              halfHourCents: booking.halfHourCents,
              slots: conversionSlots,
            }
          : null
      }
    />
  );
}
