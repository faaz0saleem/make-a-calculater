/**
 * Settlement (SPEC.md §2, §7).
 *
 * Once the 24-hour dispute window has closed, the escrow on a booking is
 * released: refund to the student, share to the tutor, commission to the
 * platform.
 *
 * There is no money logic in this file. Attendance comes from
 * `summariseAttendance`, the decision comes from `resolveBookingOutcome`, and
 * the entries come from `src/lib/money/ledger.ts`. This is the part that reads
 * rows, calls those, and writes the result in one transaction.
 *
 * Safe to run twice: the ledger's idempotency keys reject a replay, and
 * `settled_at` stops a booking being considered again.
 */

import { eq, sql } from 'drizzle-orm';

import { appendLedger } from './ledger';
import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { bookings, tutorProfiles } from './schema';
import { findBookingsAwaitingSettlement, loadSessionEvents, type SettleableBooking } from './sessions';
import { transitionBooking, type BookingStatus } from '@/lib/bookings/status';
import { pendingToAvailableEntries } from '@/lib/money/ledger';
import {
  ABSORBED_FAILURE_WINDOW_DAYS,
  platformAbsorbsFailure,
  resolveBookingOutcome,
  type BookingResolution,
} from '@/lib/money/outcomes';
import { summariseAttendance } from '@/lib/sessions/attendance';
import { sessionWindow } from '@/lib/sessions/window';

/**
 * How many connection failures we have already absorbed for this student inside
 * the window. Counted from the ledger, which is the only record that cannot
 * disagree with what was actually paid.
 */
export async function absorbedFailureCount(
  studentId: string,
  now: Date,
  database: DbLike = defaultDb,
): Promise<number> {
  const since = new Date(now.getTime() - ABSORBED_FAILURE_WINDOW_DAYS * 86_400_000);

  const rows = (await database.execute(sql`
    select count(*)::int as total
    from ledger_entries l
    join bookings b on b.id = l.booking_id
    where b.student_id = ${studentId}::uuid
      and l.reason = 'technical_failure_absorbed:absorbed'
      and l.at >= ${since.toISOString()}::timestamptz
  `)) as unknown as { total: number }[];

  return rows[0]?.total ?? 0;
}

export type SettlementLine = {
  bookingId: string;
  resolution: BookingResolution;
  refundCents: number;
  tutorCents: number;
  platformCents: number;
  status: BookingStatus;
  strike: boolean;
  /** The platform paid the tutor for a session nobody was charged for. */
  absorbed: boolean;
};

export type SettlementRun = {
  ranAt: Date;
  considered: number;
  settled: SettlementLine[];
  skipped: { bookingId: string; reason: string }[];
};

/**
 * Settle one booking. Exported so a test can drive a single case, and so the
 * job below stays a loop with no logic of its own.
 */
export async function settleBooking(
  booking: SettleableBooking,
  now: Date,
  database: DbLike = defaultDb,
): Promise<SettlementLine> {
  const window = sessionWindow(booking.startAtUtc, booking.durationMinutes);
  const events = await loadSessionEvents(booking.id, database);

  const attendance = summariseAttendance({
    events,
    window,
    studentId: booking.studentId,
    tutorId: booking.tutorId,
    now,
  });

  // The connection-failure policy: we pay for our own transport failing, twice
  // per student per ninety days. The count is a database fact, so it is read
  // here and the pure function is told the answer.
  const absorbed = await absorbedFailureCount(booking.studentId, now, database);

  const outcome = resolveBookingOutcome(
    {
      id: booking.id,
      studentId: booking.studentId,
      tutorId: booking.tutorId,
      isTrial: booking.isTrial,
      priceCents: booking.priceCents,
      commissionBps: booking.commissionBps,
      startAtUtc: booking.startAtUtc,
      durationMinutes: booking.durationMinutes,
      completedAt: booking.completedAt,
    },
    attendance,
    { absorbFailure: platformAbsorbsFailure(absorbed) },
  );

  // The status machine will not jump straight from `confirmed` to a terminal
  // state, so walk the intermediate hop the same way a live session would.
  // A booking already in `disputed` goes straight to its terminal state: an
  // admin has decided, and `disputed -> completed` is not a move backwards the
  // machine allows.
  const path: BookingStatus[] = [];
  let status = booking.status;

  if (status !== 'disputed') {
    if (outcome.resolution === 'completed' && status !== 'completed') {
      if (status === 'confirmed') path.push('in_progress');
      path.push('completed');
    } else if (outcome.resolution === 'no_show_student' && status !== 'no_show_student') {
      path.push('no_show_student');
    } else if (outcome.resolution === 'no_show_tutor' && status !== 'no_show_tutor') {
      path.push('no_show_tutor');
    } else if (outcome.resolution === 'technical_failure') {
      path.push('disputed');
    }
  }

  path.push(outcome.terminalStatus);

  await database.transaction(async (tx) => {
    await appendLedger(tx, { entries: outcome.entries, external: false });

    // The hold between pending and available is currently zero hours, so the
    // tutor's share becomes withdrawable in the same transaction.
    if (outcome.tutorCents > 0) {
      await appendLedger(
        tx,
        pendingToAvailableEntries({
          bookingId: booking.id,
          tutorId: booking.tutorId,
          amountCents: outcome.tutorCents,
        }),
      );
    }

    for (const next of path) {
      status = transitionBooking(status, next);
    }

    await tx
      .update(bookings)
      .set({
        status,
        settledAt: now,
        // A session nobody closed at the time — LiveKit never said the room
        // finished, say — is stamped here instead, so "did this happen" has
        // one answer whichever path got there.
        ...(outcome.resolution === 'completed' && !booking.completedAt ? { completedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(bookings.id, booking.id));

    // SPEC.md §2: three strikes in 90 days triggers a review.
    if (outcome.tutorStrike) {
      await tx
        .update(tutorProfiles)
        .set({ strikes: sql`${tutorProfiles.strikes} + 1`, updatedAt: now })
        .where(eq(tutorProfiles.userId, booking.tutorId));
    }
  });

  return {
    bookingId: booking.id,
    resolution: outcome.resolution,
    refundCents: outcome.refundCents,
    tutorCents: outcome.tutorCents,
    platformCents: outcome.platformCents,
    status,
    strike: outcome.tutorStrike,
    absorbed: outcome.platformAbsorbed,
  };
}

/**
 * What tonight's run would touch, without touching it.
 *
 * Useful before a change to the money rules, and the only way to ask "is this
 * booking due?" without settling every other booking that also is.
 */
export async function previewSettlement(
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<{ bookingId: string; startAtUtc: Date; status: BookingStatus }[]> {
  const due = await findBookingsAwaitingSettlement(now, database);
  return due.map((booking) => ({
    bookingId: booking.id,
    startAtUtc: booking.startAtUtc,
    status: booking.status,
  }));
}

/**
 * The nightly settlement job.
 *
 * `now` is a parameter so a test can run it a day in the future without waiting
 * a day, and so a re-run is reproducible.
 */
export async function runSettlement(now = new Date(), database: DbLike = defaultDb): Promise<SettlementRun> {
  const due = await findBookingsAwaitingSettlement(now, database);

  const settled: SettlementLine[] = [];
  const skipped: { bookingId: string; reason: string }[] = [];

  for (const booking of due) {
    try {
      settled.push(await settleBooking(booking, now, database));
    } catch (error) {
      // One bad booking must not stop the rest of the night's money moving.
      console.error(`settlement failed for booking ${booking.id}`, error);
      skipped.push({ bookingId: booking.id, reason: error instanceof Error ? error.message : 'unknown' });
    }
  }

  return { ranAt: now, considered: due.length, settled, skipped };
}

export function formatSettlementRun(run: SettlementRun): string {
  if (run.considered === 0) return 'Settlement: nothing past its dispute window.';

  const byResolution = new Map<string, number>();
  for (const line of run.settled) {
    byResolution.set(line.resolution, (byResolution.get(line.resolution) ?? 0) + 1);
  }

  const breakdown = [...byResolution].map(([resolution, count]) => `${count} ${resolution}`).join(', ');
  const failures = run.skipped.length > 0 ? ` ${run.skipped.length} FAILED.` : '';

  return `Settlement: ${run.settled.length} of ${run.considered} settled (${breakdown}).${failures}`;
}
