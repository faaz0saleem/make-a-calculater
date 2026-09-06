/**
 * Sending the nudges (SPEC.md §7, §11).
 *
 * Runs often — every five minutes is right — and is safe to run twice. Two
 * separate things make it idempotent, one per channel:
 *
 *  - The in-app bell dedupes on `notifications.dedupe_key`, which has a unique
 *    index behind it.
 *  - The outbound provider dedupes on the same key passed as its client
 *    reference, which is what every real messaging API calls it.
 *
 * So a cron that fires twice, or a retry after a timeout, sends one message.
 * That matters more here than anywhere else in the product: a duplicate ledger
 * row is caught by reconciliation, and a duplicate WhatsApp at 7am is somebody
 * turning notifications off.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db as defaultDb, type Database } from './client';
import { expireUnacceptedBookings } from './bookings';
import { notify } from './notifications';
import { bookings, users } from './schema';
import { getOutboundProvider, isReachableNumber } from '@/lib/messaging/out';
import { reminderCopy, reminderKey, remindersDue } from '@/lib/sessions/reminders';
import { formatInTimeZone } from '@/lib/time';

export type ReminderReport = {
  sessions: number;
  inApp: number;
  outbound: number;
  skipped: number;
  failed: number;
  /** Paid bookings a tutor never accepted, refunded in full. */
  expired: number;
};

/**
 * How far ahead to look.
 *
 * A day and a bit: the earliest reminder is T-24h, and the extra hour means a
 * job that runs late still finds the sessions it should have found.
 */
const HORIZON_MINUTES = 25 * 60;

export async function sendDueReminders(
  now = new Date(),
  database: Database = defaultDb,
): Promise<ReminderReport> {
  const report: ReminderReport = {
    sessions: 0,
    inApp: 0,
    outbound: 0,
    skipped: 0,
    failed: 0,
    expired: 0,
  };

  // Time-sensitive and cheap, so it rides along with the frequent job rather
  // than waiting for the nightly one: a student's credits should not sit in
  // escrow overnight against a session nobody agreed to.
  report.expired = (await expireUnacceptedBookings(now, database)).expired;

  const soon = await database
    .select({
      id: bookings.id,
      startAtUtc: bookings.startAtUtc,
      isTrial: bookings.isTrial,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
    })
    .from(bookings)
    .where(
      and(
        // Only sessions that are actually going to happen. A `scheduled`
        // recurring occurrence has not been paid for yet and may still lapse,
        // so reminding somebody about it would be a promise we cannot keep.
        inArray(bookings.status, ['confirmed', 'in_progress']),
        sql`${bookings.startAtUtc} > ${now.toISOString()}::timestamptz`,
        sql`${bookings.startAtUtc} <= ${new Date(now.getTime() + HORIZON_MINUTES * 60_000).toISOString()}::timestamptz`,
      ),
    );

  if (soon.length === 0) return report;

  const people = new Map(
    (
      await database
        .select({ id: users.id, name: users.name, phone: users.phone, timezone: users.timezone })
        .from(users)
        .where(
          inArray(users.id, [
            ...new Set(soon.flatMap((booking) => [booking.studentId, booking.tutorId])),
          ]),
        )
    ).map((row) => [row.id, row]),
  );

  const provider = getOutboundProvider();

  for (const booking of soon) {
    const due = remindersDue(booking.startAtUtc, now);
    if (due.length === 0) continue;

    report.sessions += 1;

    for (const slot of due) {
      const recipientId = slot.audience === 'tutor' ? booking.tutorId : booking.studentId;
      const otherId = slot.audience === 'tutor' ? booking.studentId : booking.tutorId;

      const recipient = people.get(recipientId);
      const other = people.get(otherId);
      if (!recipient) continue;

      const key = reminderKey(booking.id, slot);
      const copy = reminderCopy(slot, {
        otherName: other?.name ?? (slot.audience === 'tutor' ? 'your student' : 'your tutor'),
        whenLocal: formatInTimeZone(booking.startAtUtc, recipient.timezone, {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
        }),
        isTrial: booking.isTrial,
      });

      // The bell always. It is free, it is ours, and it is the record.
      await notify(
        {
          userId: recipientId,
          kind: 'session_reminder',
          title: copy.title,
          body: copy.body,
          href: `/sessions/${booking.id}`,
          dedupeKey: key,
        },
        database,
      );
      report.inApp += 1;

      // The phone only for the two that are worth interrupting somebody for,
      // and only where a number exists. A day-out reminder does not earn a
      // WhatsApp; ten minutes before does.
      const wantsPhone = slot.kind === 'hour' || slot.kind === 'final';
      if (!wantsPhone || !isReachableNumber(recipient.phone) || !provider.isReady()) {
        report.skipped += 1;
        continue;
      }

      const result = await provider.send({
        to: recipient.phone,
        body: copy.whatsapp,
        idempotencyKey: key,
      });

      if (result.ok) {
        report.outbound += 1;
      } else {
        // One unreachable number must not stop the run. The bell already went.
        report.failed += 1;
        console.error(`reminder ${key} could not be sent: ${result.reason}`);
      }
    }
  }

  return report;
}

/**
 * Somebody is in the room and the other one is not.
 *
 * Called from the classroom when one side has been alone past the threshold.
 * Idempotent on the dedupe key, so a page that polls does not send a push a
 * second.
 */
export async function nudgeAbsent(
  input: { bookingId: string; absentId: string; presentName: string; startAtUtc: Date },
  database: Database = defaultDb,
): Promise<void> {
  const [person] = await database
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, input.absentId))
    .limit(1);

  const key = `waiting:${input.bookingId}`;
  const body = `${input.presentName} is in the room waiting for you. Join now.`;

  await notify(
    {
      userId: input.absentId,
      kind: 'session_waiting',
      title: 'Your lesson has started without you',
      body,
      href: `/sessions/${input.bookingId}`,
      dedupeKey: key,
    },
    database,
  );

  const provider = getOutboundProvider();
  if (!isReachableNumber(person?.phone) || !provider.isReady()) return;

  await provider.send({
    to: person!.phone!,
    body: `Tutorly: ${body} tutorly.test/sessions/${input.bookingId}`,
    idempotencyKey: key,
  });
}
