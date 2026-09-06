/**
 * The `.ics` for one session (SPEC.md §7).
 *
 * Scoped to the two people on the booking, checked here rather than trusted
 * from the URL: a session in somebody's calendar names who they are meeting and
 * when they will be at their desk, which is not something to hand out to
 * anybody holding a link.
 */

import { and, eq, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { bookings, users } from '@/db/schema';
import { currentUser } from '@/lib/auth/guards';
import { buildIcs } from '@/lib/calendar/ics';
import { getEnv } from '@/lib/env';
import { sessionWindow } from '@/lib/sessions/window';
import { topicsOnBooking } from '@/db/topics';

function missing(): Response {
  return new Response('Not found', { status: 404 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  const viewer = await currentUser();
  if (!viewer) return missing();

  const { bookingId } = await context.params;

  const [booking] = await db
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
      isTrial: bookings.isTrial,
      rescheduleCount: bookings.rescheduleCount,
      topicNote: bookings.topicNote,
      tutorName: users.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.tutorId))
    .where(
      and(
        eq(bookings.id, bookingId),
        or(eq(bookings.studentId, viewer.id), eq(bookings.tutorId, viewer.id)),
      ),
    )
    .limit(1);

  if (!booking) return missing();

  const topics = await topicsOnBooking(bookingId);
  const window = sessionWindow(booking.startAtUtc, booking.durationMinutes);
  const url = `${getEnv().AUTH_URL ?? ''}/sessions/${booking.id}`;

  const details = [
    topics.length > 0 ? topics.map((topic) => topic.name).join('; ') : null,
    booking.topicNote,
    'Join from the session page a few minutes before it starts.',
  ]
    .filter(Boolean)
    .join('\n');

  const cancelled = ['cancelled_by_student', 'cancelled_by_tutor', 'expired', 'lapsed'].includes(
    booking.status,
  );

  const ics = buildIcs({
    bookingId: booking.id,
    title: `${booking.isTrial ? 'Trial lesson' : 'Lesson'} with ${booking.tutorName ?? 'your tutor'}`,
    description: details,
    startUtc: window.startUtc,
    endUtc: window.endUtc,
    url,
    // Every reschedule bumps this, so a client replaces the entry rather than
    // adding a second one.
    sequence: booking.rescheduleCount,
    cancelled,
    organiserName: booking.tutorName ?? undefined,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="tutorly-${booking.id.slice(0, 8)}.ics"`,
      'cache-control': 'private, no-store',
    },
  });
}
