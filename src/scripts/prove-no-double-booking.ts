/**
 * Prove that two people cannot take the same slot.
 *
 * Fires N genuinely parallel `createBooking` calls at one slot — separate
 * connections, separate serializable transactions, all in flight at once — and
 * prints what happened as JSON. Exactly one must succeed.
 *
 *   pnpm prove:booking
 *   pnpm prove:booking --clients 5
 *
 * This is a diagnostic you can run against any environment, and it is what
 * `e2e/booking.spec.ts` asserts on. Sequential calls would prove nothing: the
 * question is what Postgres does when both transactions read the slot as free
 * before either has written.
 */

import './bootstrap';

import { sql } from 'drizzle-orm';

import { createBooking } from '@/db/bookings';
import { db } from '@/db/client';
import { getAvailability } from '@/lib/availability';

type Row = { id: string; email: string };

async function main() {
  const index = process.argv.indexOf('--clients');
  const clients = index === -1 ? 2 : Math.max(2, Math.min(Number(process.argv[index + 1]), 10));

  // Any verified tutor with hours published and enough students to race.
  const tutors = (await db.execute(sql`
    select u.id::text, u.email
    from tutor_profiles p
    join users u on u.id = p.user_id
    where p.status = 'verified'
      and exists (select 1 from availability_rules r where r.tutor_id = p.user_id and r.active)
    order by u.email
    limit 20
  `)) as unknown as Row[];

  const students = (await db.execute(sql`
    select u.id::text, u.email
    from users u
    join student_wallets w on w.user_id = u.id
    where 'student' = any(u.roles) and w.credits_cents >= 20000
      and not exists (select 1 from tutor_profiles p where p.user_id = u.id)
    order by w.credits_cents desc
    limit ${clients}
  `)) as unknown as Row[];

  if (students.length < clients) {
    throw new Error(`need ${clients} students with credits, found ${students.length}`);
  }

  for (const tutor of tutors) {
    const free = await getAvailability().freeSlotsFor({
      tutorId: tutor.id,
      durationMinutes: 60,
      toUtc: new Date(Date.now() + 14 * 86_400_000),
      limit: 1,
    });

    if (!free.known || free.value.length === 0) continue;
    const slot = free.value[0]!.startUtc;

    // Everything up to here is preparation. This is the test: all of them at
    // once, none of them waiting for the others.
    const results = await Promise.all(
      students.map((student) =>
        createBooking({
          studentId: student.id,
          tutorId: tutor.id,
          startAtUtc: slot,
          durationMinutes: 60,
        }),
      ),
    );

    const [row] = (await db.execute(sql`
      select count(*)::int as bookings,
             (select count(*)::int from ledger_entries l
               join bookings b on b.id = l.booking_id
              where b.tutor_id = ${tutor.id}::uuid
                and b.start_at_utc = ${slot.toISOString()}::timestamptz
                and l.account = 'escrow') as escrow_entries
        from bookings
       where tutor_id = ${tutor.id}::uuid
         and start_at_utc = ${slot.toISOString()}::timestamptz
         and status in ('pending_tutor', 'confirmed', 'in_progress')
    `)) as unknown as { bookings: number; escrow_entries: number }[];

    console.log(
      JSON.stringify(
        {
          tutorEmail: tutor.email,
          slot: slot.toISOString(),
          clients: students.length,
          succeeded: results.filter((result) => result.ok).length,
          failures: results.filter((result) => !result.ok).map((result) => (result as { problem: string }).problem),
          bookingsInDatabase: row?.bookings ?? 0,
          escrowEntries: row?.escrow_entries ?? 0,
        },
        null,
        2,
      ),
    );

    process.exit(0);
  }

  throw new Error('no verified tutor had a free 60-minute slot to race for');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
