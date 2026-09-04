/**
 * What commission a booking between these two would carry right now.
 *
 *   pnpm prove:commission <studentId> <tutorId>
 *
 * The retention rate is decided at creation and snapshotted, so this is the
 * only way to ask the question without actually taking somebody's money. It
 * reads the same fact `createBooking` reads — a paid session between them that
 * actually happened — and runs the same pure function over it.
 */

import './bootstrap';

import { and, count, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { bookings, tutorProfiles } from '@/db/schema';
import { commissionBpsFor } from '@/lib/money/commission';

async function main() {
  const [studentId, tutorId] = process.argv.slice(2);

  if (!studentId || !tutorId) {
    console.error('usage: pnpm prove:commission <studentId> <tutorId>');
    process.exit(1);
  }

  const [row] = await db
    .select({ total: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.studentId, studentId),
        eq(bookings.tutorId, tutorId),
        eq(bookings.isTrial, false),
        sql`${bookings.completedAt} is not null`,
      ),
    );

  const completed = row?.total ?? 0;

  const [profile] = await db
    .select({ negotiatedBps: tutorProfiles.commissionBps })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, tutorId))
    .limit(1);

  console.log(
    JSON.stringify(
      {
        studentId,
        tutorId,
        completedPaidSessions: completed,
        negotiatedBps: profile?.negotiatedBps ?? null,
        commissionBps: commissionBpsFor(completed > 0, profile?.negotiatedBps),
      },
      null,
      2,
    ),
  );

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
