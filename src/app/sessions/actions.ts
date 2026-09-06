'use server';

/**
 * Telling the absent one they are absent (SPEC.md §7).
 *
 * Called from the classroom once somebody has been alone past the threshold.
 * Idempotent on a dedupe key, so a page that re-renders does not send a second
 * push — and scoped to the two people on the booking, so a stray id in a fetch
 * cannot make the product message a stranger.
 */

import { and, eq, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { nudgeAbsent } from '@/db/reminders';
import { bookings, users } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';

export async function callTheAbsent(bookingId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();

  const [booking] = await db
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      startAtUtc: bookings.startAtUtc,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, bookingId),
        or(eq(bookings.studentId, user.id), eq(bookings.tutorId, user.id)),
      ),
    )
    .limit(1);

  if (!booking) return { ok: false };
  if (booking.status !== 'confirmed' && booking.status !== 'in_progress') return { ok: false };

  const absentId = booking.studentId === user.id ? booking.tutorId : booking.studentId;

  const [me] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  await nudgeAbsent({
    bookingId: booking.id,
    absentId,
    presentName: me?.name ?? 'The other person',
    startAtUtc: booking.startAtUtc,
  });

  return { ok: true };
}
