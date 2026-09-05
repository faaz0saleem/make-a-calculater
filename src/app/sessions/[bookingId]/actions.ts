'use server';

/**
 * Getting into a session (SPEC.md §7).
 *
 * The token is minted from the booking row and the server-side session. Nothing
 * a browser sends decides who it is for or how long it lasts.
 */

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { bookings } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { LIVEKIT_UNCONFIGURED_MESSAGE } from '@/lib/livekit/config';
import { mintSessionToken } from '@/lib/livekit/tokens';

export type JoinTicket =
  | { ok: true; token: string; url: string; roomName: string; serverNowIso: string }
  | { ok: false; error: string; retryInSeconds?: number };

export async function requestSessionToken(bookingId: string): Promise<JoinTicket> {
  const user = await requireUser();

  const [booking] = await db
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  // Not their booking, or no such booking: the same answer either way, so the
  // endpoint cannot be used to discover that a session exists (SPEC.md §16).
  if (!booking || (booking.studentId !== user.id && booking.tutorId !== user.id)) {
    return { ok: false, error: 'That session could not be found.' };
  }

  if (['cancelled_by_student', 'cancelled_by_tutor', 'expired', 'refunded'].includes(booking.status)) {
    return { ok: false, error: 'This session was cancelled.' };
  }

  const minted = await mintSessionToken(
    {
      bookingId: booking.id,
      startAtUtc: booking.startAtUtc,
      durationMinutes: booking.durationMinutes,
      studentId: booking.studentId,
      tutorId: booking.tutorId,
    },
    user.id,
    user.name,
  );

  if (!minted.ok) {
    switch (minted.reason) {
      case 'not_configured':
        return { ok: false, error: LIVEKIT_UNCONFIGURED_MESSAGE };
      case 'not_a_participant':
        return { ok: false, error: 'That session could not be found.' };
      case 'too_early':
        return {
          ok: false,
          error: 'The room is not open yet. It opens five minutes before the session starts.',
          retryInSeconds: minted.opensInSeconds,
        };
      case 'over':
        return { ok: false, error: 'This session has ended.' };
    }
  }

  return {
    ok: true,
    token: minted.token,
    url: minted.url,
    roomName: minted.roomName,
    serverNowIso: minted.serverNowIso,
  };
}
