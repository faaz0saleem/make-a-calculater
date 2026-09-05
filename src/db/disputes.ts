/**
 * Disputes (SPEC.md §10).
 *
 * Escrow is held for twenty-four hours "in case anything went wrong". Until
 * now there was no way for anyone to say that something did — settlement simply
 * released the money on schedule. A report freezes it.
 *
 * The freeze needs no new code in the settlement job: `disputed` is not one of
 * the statuses `findBookingsAwaitingSettlement` looks for, so a disputed
 * booking drops out of the query until an admin resolves it. That is the
 * cheapest possible implementation of "stop the money", and the hardest to get
 * wrong later.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { appendLedger } from './ledger';
import { db as defaultDb, type Database } from './client';
import type { DbLike } from './ledger';
import { notify } from './notifications';
import { moveBookingStatus } from './sessions';
import { settleBooking } from './settlement';
import { bookings, reports, users } from './schema';
import { writeAudit } from '@/lib/admin/audit';
import { adminRefundOutcome } from '@/lib/money/outcomes';
import { sessionWindow } from '@/lib/sessions/window';

/** Statuses a booking can be disputed from — the ones settlement would pick up. */
const DISPUTABLE = ['confirmed', 'in_progress', 'completed', 'no_show_student', 'no_show_tutor'];

export type DisputeProblem =
  | 'not_found'
  | 'not_yours'
  | 'not_disputable'
  | 'window_closed'
  | 'already_disputed'
  | 'no_reason';

const MESSAGES: Record<DisputeProblem, string> = {
  not_found: 'That session could not be found.',
  not_yours: 'That session could not be found.',
  not_disputable: 'This session cannot be reported — it has not happened, or it was already settled.',
  window_closed:
    'The 24-hour window for reporting a problem with this session has closed. Contact support if you still need help.',
  already_disputed: 'This session is already with our team.',
  no_reason: 'Tell us what went wrong, in a sentence.',
};

export function disputeProblemMessage(problem: DisputeProblem): string {
  return MESSAGES[problem];
}

export type ReportResult = { ok: true; reportId: string } | { ok: false; problem: DisputeProblem };

/**
 * Report a problem with a session.
 *
 * Open to both sides while the dispute window is open. It moves the booking to
 * `disputed` through the state machine and files a report for the admin queue.
 */
export async function reportBookingProblem(
  input: { bookingId: string; reporterId: string; reason: string; body?: string | null },
  now = new Date(),
  database: Database = defaultDb,
): Promise<ReportResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, problem: 'no_reason' };

  const [booking] = await database
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      status: bookings.status,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      settledAt: bookings.settledAt,
    })
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);

  if (!booking) return { ok: false, problem: 'not_found' };
  if (booking.studentId !== input.reporterId && booking.tutorId !== input.reporterId) {
    return { ok: false, problem: 'not_yours' };
  }
  if (booking.status === 'disputed') return { ok: false, problem: 'already_disputed' };
  if (booking.settledAt || !DISPUTABLE.includes(booking.status)) {
    return { ok: false, problem: 'not_disputable' };
  }

  // The same 24 hours settlement waits for.
  const window = sessionWindow(booking.startAtUtc, booking.durationMinutes);
  if (now >= window.settlesAfterUtc) return { ok: false, problem: 'window_closed' };

  const reportId = await database.transaction(async (tx) => {
    await moveBookingStatus(booking.id, 'disputed', {}, tx);

    const [created] = await tx
      .insert(reports)
      .values({
        reporterId: input.reporterId,
        targetType: 'booking',
        targetId: booking.id,
        reason: reason.slice(0, 120),
        body: input.body?.slice(0, 2_000) ?? null,
        status: 'open',
      })
      .returning({ id: reports.id });

    return created!.id;
  });

  // The other side is told, because their money is frozen too.
  const otherId = booking.studentId === input.reporterId ? booking.tutorId : booking.studentId;
  await notify(
    {
      userId: otherId,
      kind: 'new_message',
      title: 'A session has been reported',
      body: 'Our team is looking at it. Nothing settles until they have.',
      href: '/dashboard',
      dedupeKey: `dispute:${reportId}:other`,
    },
    database,
  );

  return { ok: true, reportId };
}

export type OpenDispute = {
  reportId: string;
  bookingId: string;
  reporterId: string;
  reporterName: string;
  studentName: string;
  tutorName: string;
  reason: string;
  body: string | null;
  priceCents: number;
  startAtUtc: Date;
  durationMinutes: number;
  createdAt: Date;
};

export async function openDisputes(
  limit = 50,
  database: DbLike = defaultDb,
): Promise<OpenDispute[]> {
  const rows = await database
    .select({
      reportId: reports.id,
      bookingId: bookings.id,
      reporterId: reports.reporterId,
      reporterName: users.name,
      reason: reports.reason,
      body: reports.body,
      priceCents: bookings.priceCents,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      createdAt: reports.createdAt,
      studentName: sql<string>`student.name`,
      tutorName: sql<string>`tutor.name`,
    })
    .from(reports)
    .innerJoin(bookings, sql`${bookings.id} = ${reports.targetId}`)
    .innerJoin(users, eq(users.id, reports.reporterId))
    .innerJoin(sql`users as student`, sql`student.id = ${bookings.studentId}`)
    .innerJoin(sql`users as tutor`, sql`tutor.id = ${bookings.tutorId}`)
    .where(and(eq(reports.targetType, 'booking'), eq(reports.status, 'open')))
    .orderBy(desc(reports.createdAt))
    .limit(limit);

  return rows;
}

export type DisputeDecision = 'settle' | 'refund';

export type ResolveDisputeResult =
  | { ok: true; decision: DisputeDecision; refundCents: number }
  | { ok: false; problem: 'not_found' | 'no_reason' };

/**
 * An admin decides.
 *
 * `settle` runs the ordinary settlement for the booking — whatever the
 * attendance says should have happened, happens now. `refund` overrides it and
 * returns the student's credits, which is the only decision a human makes that
 * the attendance cannot.
 */
export async function resolveDispute(
  input: {
    reportId: string;
    admin: { id: string; ip?: string | null };
    decision: DisputeDecision;
    reason: string;
  },
  now = new Date(),
  database: Database = defaultDb,
): Promise<ResolveDisputeResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, problem: 'no_reason' };

  const [report] = await database
    .select({ id: reports.id, targetId: reports.targetId, status: reports.status })
    .from(reports)
    .where(and(eq(reports.id, input.reportId), eq(reports.targetType, 'booking')))
    .limit(1);

  if (!report || report.status !== 'open') return { ok: false, problem: 'not_found' };

  const [booking] = await database
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      commissionBps: bookings.commissionBps,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
      completedAt: bookings.completedAt,
      settledAt: bookings.settledAt,
    })
    .from(bookings)
    .where(eq(bookings.id, report.targetId))
    .limit(1);

  if (!booking) return { ok: false, problem: 'not_found' };

  let refundCents = 0;

  if (input.decision === 'refund') {
    const outcome = adminRefundOutcome(booking);
    refundCents = outcome.refundCents;

    await database.transaction(async (tx) => {
      await appendLedger(tx, { entries: outcome.entries, external: false });
      await moveBookingStatus(booking.id, 'refunded', { settledAt: now, updatedAt: now }, tx);
    });
  } else {
    const line = await settleBooking(
      { ...booking, status: booking.status as never },
      now,
      database,
    );
    refundCents = line.refundCents;
  }

  await database.transaction(async (tx) => {
    await tx
      .update(reports)
      .set({ status: 'resolved', resolvedAt: now })
      .where(eq(reports.id, report.id));

    await writeAudit(tx, {
      actorId: input.admin.id,
      action: input.decision === 'refund' ? 'dispute.refund' : 'dispute.settle',
      targetType: 'booking',
      targetId: booking.id,
      before: { status: 'disputed', priceCents: booking.priceCents },
      after: { decision: input.decision, refundCents },
      reason,
      ip: input.admin.ip ?? null,
    });
  });

  for (const userId of [booking.studentId, booking.tutorId]) {
    await notify(
      {
        userId,
        kind: 'new_message',
        title: 'Your reported session has been resolved',
        body:
          input.decision === 'refund'
            ? 'The credits have been returned to the student.'
            : 'It has been settled as it stood.',
        href: '/dashboard',
        dedupeKey: `dispute:${report.id}:resolved:${userId}`,
      },
      database,
    );
  }

  return { ok: true, decision: input.decision, refundCents };
}
