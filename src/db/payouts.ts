/**
 * Payout methods and payouts (SPEC.md §2, §16).
 *
 * Two rules hold this file together, and both are about money leaving.
 *
 *  1. **Nothing in here ever returns an account number.** The encrypted columns
 *     are read in exactly one function, `decryptForTransfer`, which exists so
 *     that whoever eventually wires up a real bank API has one obvious place to
 *     call and one obvious place to audit. Every other query selects `last4`
 *     and stops. There is no admin exception: an admin approving a payout does
 *     not need to see the number, and a support tool that can see it is a
 *     support tool that can leak it.
 *
 *  2. **Requesting a payout moves the money in the same transaction.** The
 *     amount leaves `tutor_available` and lands in `payout_locked` as ledger
 *     entries, so it cannot be spent, requested again, or counted twice while
 *     an admin is looking at it.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { appendLedger } from './ledger';
import { db as defaultDb } from './client';
import { emailPayoutStatus } from './email-events';
import type { DbLike } from './ledger';
import { payoutMethods, payouts, tutorProfiles, users } from './schema';
import { writeAudit, type AuditAction } from '@/lib/admin/audit';
import { payoutGate } from '@/lib/auth/verification';
import { decryptSecret, encryptSecret, last4 } from '@/lib/crypto';
import { payoutPaidEntries, payoutReleaseEntries, payoutRequestEntries } from '@/lib/money/ledger';
import {
  canRequestPayout,
  canTransitionPayout,
  PAYOUT_THRESHOLD_CENTS,
  type PayoutMethodKind,
  type PayoutStatus,
} from '@/lib/money/payouts';

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/**
 * A payout method as any screen is allowed to see it.
 *
 * There is no field here that could be used to move money. That is the point:
 * the type is the guarantee, so a new page cannot accidentally render an
 * account number because it never had one.
 */
export type PayoutMethodView = {
  id: string;
  kind: PayoutMethodKind;
  accountTitle: string;
  bankName: string | null;
  walletProvider: string | null;
  country: string;
  last4: string;
  hasSwift: boolean;
  hasBranchCode: boolean;
  isDefault: boolean;
  createdAt: Date;
};

const METHOD_VIEW = {
  id: payoutMethods.id,
  kind: payoutMethods.kind,
  accountTitle: payoutMethods.accountTitle,
  bankName: payoutMethods.bankName,
  walletProvider: payoutMethods.walletProvider,
  country: payoutMethods.country,
  last4: payoutMethods.last4,
  // Whether a field was given, never what it says.
  hasSwift: sql<boolean>`${payoutMethods.swiftEnc} is not null`,
  hasBranchCode: sql<boolean>`${payoutMethods.branchCodeEnc} is not null`,
  isDefault: payoutMethods.isDefault,
  createdAt: payoutMethods.createdAt,
} as const;

export async function payoutMethodFor(
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<PayoutMethodView | null> {
  const [row] = await database
    .select(METHOD_VIEW)
    .from(payoutMethods)
    .where(and(eq(payoutMethods.tutorId, tutorId), eq(payoutMethods.isDefault, true)))
    .limit(1);

  return (row as PayoutMethodView | undefined) ?? null;
}

export type PayoutMethodInput = {
  kind: PayoutMethodKind;
  accountTitle: string;
  country: string;
  /** IBAN, account number, or the wallet's mobile number. */
  accountNumber: string;
  bankName?: string | null;
  walletProvider?: string | null;
  swift?: string | null;
  /** Pakistani local accounts are addressed by branch code rather than SWIFT. */
  branchCode?: string | null;
  cnic?: string | null;
};

/**
 * Save the account a tutor is paid into, replacing whatever was there.
 *
 * Everything identifying is encrypted here and nowhere else, so there is one
 * place to read to know what is protected. `last4` is derived at write time
 * because it is the only thing that will ever be read back.
 */
export async function savePayoutMethod(
  tutorId: string,
  input: PayoutMethodInput,
  database: DbLike = defaultDb,
): Promise<PayoutMethodView> {
  const run = async (tx: DbLike) => {
    // One default per tutor. Replacing the account is a delete and an insert
    // rather than an update, so no old ciphertext lingers in a dead row.
    await tx.delete(payoutMethods).where(eq(payoutMethods.tutorId, tutorId));

    await tx.insert(payoutMethods).values({
      tutorId,
      kind: input.kind,
      accountTitle: input.accountTitle,
      bankName: input.kind === 'bank' ? (input.bankName ?? null) : null,
      walletProvider: input.kind === 'mobile_wallet' ? (input.walletProvider ?? null) : null,
      country: input.country.toUpperCase(),
      accountNumberEnc: encryptSecret(input.accountNumber),
      swiftEnc: input.swift ? encryptSecret(input.swift) : null,
      branchCodeEnc: input.branchCode ? encryptSecret(input.branchCode) : null,
      cnicEnc: input.cnic ? encryptSecret(input.cnic) : null,
      last4: last4(input.accountNumber),
      isDefault: true,
    });

    return (await payoutMethodFor(tutorId, tx))!;
  };

  return 'transaction' in database ? database.transaction((tx) => run(tx as DbLike)) : run(database);
}

/**
 * The cleartext, for actually sending money.
 *
 * The **only** decrypting read in the codebase. Nothing renders this, nothing
 * logs it, and nothing returns it over HTTP — it exists for the bank
 * integration that does not exist yet, and it is deliberately awkward to reach
 * so that adding a second caller is a decision somebody makes on purpose.
 */
export async function decryptForTransfer(
  methodId: string,
  database: DbLike = defaultDb,
): Promise<{
  accountTitle: string;
  accountNumber: string;
  swift: string | null;
  branchCode: string | null;
} | null> {
  const [row] = await database
    .select({
      accountTitle: payoutMethods.accountTitle,
      accountNumberEnc: payoutMethods.accountNumberEnc,
      swiftEnc: payoutMethods.swiftEnc,
      branchCodeEnc: payoutMethods.branchCodeEnc,
    })
    .from(payoutMethods)
    .where(eq(payoutMethods.id, methodId))
    .limit(1);

  if (!row) return null;

  return {
    accountTitle: row.accountTitle,
    accountNumber: decryptSecret(row.accountNumberEnc),
    swift: row.swiftEnc ? decryptSecret(row.swiftEnc) : null,
    branchCode: row.branchCodeEnc ? decryptSecret(row.branchCodeEnc) : null,
  };
}

// ---------------------------------------------------------------------------
// Requesting
// ---------------------------------------------------------------------------

export type PayoutRequestResult =
  | { ok: true; payoutId: string; amountCents: number }
  | { ok: false; reason: string };

/**
 * Ask for a payout.
 *
 * The balance is read **inside** the transaction and the ledger entries are
 * written in the same one, so two requests fired at once cannot both see the
 * same available balance and both succeed. The row and the money move together
 * or neither does.
 */
export async function requestPayout(
  tutorId: string,
  amountCents: number,
  database: DbLike = defaultDb,
): Promise<PayoutRequestResult> {
  const run = async (tx: DbLike): Promise<PayoutRequestResult> => {
    const [profile] = await tx
      .select({ availableCents: tutorProfiles.availableCents })
      .from(tutorProfiles)
      .where(eq(tutorProfiles.userId, tutorId))
      // Nobody else may read this row until we are done with it, which is what
      // stops two tabs each seeing $100 and each requesting it.
      .for('update')
      .limit(1);

    if (!profile) return { ok: false, reason: 'That tutor profile could not be found.' };

    // The other place a confirmed address is required (SPEC.md §1). Checked
    // before the balance, so a tutor who cannot be paid yet is told the real
    // reason rather than something about their balance.
    const [account] = await tx
      .select({ emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, tutorId))
      .limit(1);

    const gate = payoutGate(account?.emailVerified != null);
    if (!gate.allowed) return { ok: false, reason: gate.reason };

    const eligible = canRequestPayout(profile.availableCents, amountCents);
    if (!eligible.ok) return { ok: false, reason: eligible.reason };

    const method = await payoutMethodFor(tutorId, tx);
    if (!method) {
      return { ok: false, reason: 'Add the account you want to be paid into first.' };
    }

    const [created] = await tx
      .insert(payouts)
      .values({ tutorId, methodId: method.id, amountCents, status: 'requested' })
      .returning({ id: payouts.id });

    const payoutId = created!.id;

    await appendLedger(tx, payoutRequestEntries({ payoutId, tutorId, amountCents }));

    return { ok: true, payoutId, amountCents };
  };

  const result = await ('transaction' in database
    ? database.transaction((tx) => run(tx as DbLike))
    : run(database));

  // The request itself is worth an email: it locks money, and a tutor who does
  // not remember requesting it should find out now rather than when the balance
  // looks wrong.
  if (result.ok) await emailPayoutStatus({ payoutId: result.payoutId, status: 'requested' }, database);

  return result;
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export type PayoutDecision =
  | { to: 'approved' }
  | { to: 'processing' }
  | { to: 'paid'; reference: string }
  | { to: 'rejected'; reason: string };

export type DecideResult = { ok: true; status: PayoutStatus } | { ok: false; reason: string };

/**
 * Which audit action each transition is filed under.
 *
 * `approved` and `processing` are both the same judgement — an admin saying
 * yes — so they share `payout.approve`; the before/after on the row says which
 * step it was.
 */
const AUDIT_ACTIONS: Record<PayoutDecision['to'], AuditAction> = {
  approved: 'payout.approve',
  processing: 'payout.approve',
  paid: 'payout.paid',
  rejected: 'payout.reject',
};

/**
 * Move a payout along, and move the money when the transition says to.
 *
 * `paid` retires the locked amount — the money has genuinely left the platform,
 * so the ledger records it leaving rather than moving it somewhere else.
 * `rejected` puts it back into available, because a payout that did not happen
 * is money the tutor still has.
 *
 * The state machine is in `lib/money/payouts.ts` and is the only thing that
 * decides what may follow what.
 *
 * Every decision writes an `admin_audit` row in the same transaction, so a
 * payout cannot be approved, paid or refused without a record of who did it.
 */
export async function decidePayout(
  payoutId: string,
  admin: { id: string; ip?: string | null },
  decision: PayoutDecision,
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<DecideResult> {
  const run = async (tx: DbLike): Promise<DecideResult> => {
    const [payout] = await tx
      .select({
        id: payouts.id,
        tutorId: payouts.tutorId,
        amountCents: payouts.amountCents,
        feeCents: payouts.feeCents,
        status: payouts.status,
      })
      .from(payouts)
      .where(eq(payouts.id, payoutId))
      .for('update')
      .limit(1);

    if (!payout) return { ok: false, reason: 'No such payout.' };

    const from = payout.status as PayoutStatus;
    if (!canTransitionPayout(from, decision.to)) {
      return {
        ok: false,
        reason: `A payout that is ${from} cannot become ${decision.to}. The order is requested, approved, on its way, paid.`,
      };
    }

    if (decision.to === 'paid') {
      await appendLedger(
        tx,
        payoutPaidEntries({
          payoutId: payout.id,
          tutorId: payout.tutorId,
          amountCents: payout.amountCents,
          feeCents: payout.feeCents,
        }),
      );
    }

    if (decision.to === 'rejected') {
      await appendLedger(
        tx,
        payoutReleaseEntries({
          payoutId: payout.id,
          tutorId: payout.tutorId,
          amountCents: payout.amountCents,
        }),
      );
    }

    await tx
      .update(payouts)
      .set({
        status: decision.to,
        decidedBy: admin.id,
        decidedAt: now,
        paidRef: decision.to === 'paid' ? decision.reference : undefined,
        rejectReason: decision.to === 'rejected' ? decision.reason : undefined,
      })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, from)));

    await writeAudit(tx, {
      actorId: admin.id,
      action: AUDIT_ACTIONS[decision.to],
      targetType: 'payout',
      targetId: payout.id,
      before: { status: from },
      after: {
        status: decision.to,
        amountCents: payout.amountCents,
        // The reference, never the account it went to.
        reference: decision.to === 'paid' ? decision.reference : null,
      },
      reason: decision.to === 'rejected' ? decision.reason : null,
      ip: admin.ip ?? null,
    });

    return { ok: true, status: decision.to };
  };

  const result = await ('transaction' in database
    ? database.transaction((tx) => run(tx as DbLike))
    : run(database));

  // Outside the transaction, and only for the states a tutor is waiting to hear
  // about. `processing` is an internal step, and telling somebody their money is
  // "processing" is how they learn to ignore the messages that matter.
  if (result.ok && (decision.to === 'approved' || decision.to === 'paid')) {
    await emailPayoutStatus({ payoutId, status: decision.to }, database);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type PayoutRow = {
  id: string;
  amountCents: number;
  feeCents: number;
  status: PayoutStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  paidRef: string | null;
  rejectReason: string | null;
  last4: string | null;
};

export async function payoutHistoryFor(
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<PayoutRow[]> {
  return database
    .select({
      id: payouts.id,
      amountCents: payouts.amountCents,
      feeCents: payouts.feeCents,
      status: payouts.status,
      requestedAt: payouts.requestedAt,
      decidedAt: payouts.decidedAt,
      paidRef: payouts.paidRef,
      rejectReason: payouts.rejectReason,
      last4: payoutMethods.last4,
    })
    .from(payouts)
    .leftJoin(payoutMethods, eq(payoutMethods.id, payouts.methodId))
    .where(eq(payouts.tutorId, tutorId))
    .orderBy(desc(payouts.requestedAt)) as unknown as Promise<PayoutRow[]>;
}

export type PayoutQueueRow = PayoutRow & {
  tutorId: string;
  tutorName: string;
  tutorEmail: string;
  methodKind: PayoutMethodKind | null;
  bankName: string | null;
  walletProvider: string | null;
  country: string | null;
  accountTitle: string | null;
};

const QUEUE_VIEW = {
  id: payouts.id,
  amountCents: payouts.amountCents,
  feeCents: payouts.feeCents,
  status: payouts.status,
  requestedAt: payouts.requestedAt,
  decidedAt: payouts.decidedAt,
  paidRef: payouts.paidRef,
  rejectReason: payouts.rejectReason,
  tutorId: payouts.tutorId,
  tutorName: users.name,
  tutorEmail: users.email,
  methodKind: payoutMethods.kind,
  bankName: payoutMethods.bankName,
  walletProvider: payoutMethods.walletProvider,
  country: payoutMethods.country,
  accountTitle: payoutMethods.accountTitle,
  last4: payoutMethods.last4,
  // Note what is not here: `account_number_enc`. The admin queue is the one
  // screen most likely to grow a "just show me the number" field, so the
  // column never reaches it.
} as const;

/** The admin queue, oldest first: somebody has been waiting longest. */
export async function payoutQueue(
  statuses: readonly PayoutStatus[] = ['requested', 'approved', 'processing'],
  database: DbLike = defaultDb,
): Promise<PayoutQueueRow[]> {
  return database
    .select(QUEUE_VIEW)
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.tutorId))
    .leftJoin(payoutMethods, eq(payoutMethods.id, payouts.methodId))
    .where(sql`${payouts.status} in ${statuses}`)
    .orderBy(payouts.requestedAt) as unknown as Promise<PayoutQueueRow[]>;
}

/** What was recently settled or refused, so a decision can be checked after the fact. */
export async function recentPayoutDecisions(
  limit = 20,
  database: DbLike = defaultDb,
): Promise<PayoutQueueRow[]> {
  return database
    .select(QUEUE_VIEW)
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.tutorId))
    .leftJoin(payoutMethods, eq(payoutMethods.id, payouts.methodId))
    .where(sql`${payouts.status} in ('paid', 'rejected')`)
    .orderBy(desc(payouts.decidedAt))
    .limit(limit) as unknown as Promise<PayoutQueueRow[]>;
}

/**
 * What each of these tutors has been paid before.
 *
 * An admin looking at a $400 request is really asking one question: is this
 * somebody's first payout or their tenth? The queue could not answer it, so the
 * only way to check was to leave the screen. One grouped query rather than one
 * per row, because the queue is a list and a per-row lookup is how a list
 * quietly becomes twenty round trips.
 *
 * Deliberately no account details: this is history, not destinations, and the
 * rule that an admin never sees the number holds here too.
 */
export type TutorPayoutHistory = {
  paidCount: number;
  paidCents: number;
  rejectedCount: number;
  lastPaidAt: Date | null;
};

export async function payoutHistoryByTutor(
  tutorIds: readonly string[],
  database: DbLike = defaultDb,
): Promise<Map<string, TutorPayoutHistory>> {
  if (tutorIds.length === 0) return new Map();

  const rows = await database
    .select({
      tutorId: payouts.tutorId,
      paidCount: sql<number>`count(*) filter (where ${payouts.status} = 'paid')::int`,
      paidCents: sql<number>`coalesce(sum(${payouts.amountCents}) filter (where ${payouts.status} = 'paid'), 0)::int`,
      rejectedCount: sql<number>`count(*) filter (where ${payouts.status} = 'rejected')::int`,
      lastPaidAt: sql<Date | null>`max(${payouts.decidedAt}) filter (where ${payouts.status} = 'paid')`,
    })
    .from(payouts)
    .where(inArray(payouts.tutorId, [...tutorIds]))
    .groupBy(payouts.tutorId);

  return new Map(
    rows.map((row) => [
      row.tutorId,
      {
        paidCount: Number(row.paidCount),
        paidCents: Number(row.paidCents),
        rejectedCount: Number(row.rejectedCount),
        lastPaidAt: row.lastPaidAt ? new Date(row.lastPaidAt) : null,
      },
    ]),
  );
}

export { PAYOUT_THRESHOLD_CENTS };

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

export type EarningRow = {
  bookingId: string;
  startAtUtc: Date;
  durationMinutes: number;
  studentName: string;
  status: string;
  priceCents: number;
  /** The rate snapshotted on this booking, which may not be today's rate. */
  commissionBps: number;
  platformCents: number;
  tutorCents: number;
  settledAt: Date | null;
};

/**
 * What each session actually paid, at the rate it actually carried.
 *
 * Read from the **ledger**, not recomputed from the price and today's
 * constants: a session settled under the old 20% did earn 80%, and a page that
 * recalculated it would quietly rewrite the tutor's history. After the
 * repricing a tutor sees 15%, 16%, 20% and 22% sitting next to each other, and
 * the row's own rate is printed beside each one so it reads as history rather
 * than as a bug.
 */
export async function earningsFor(
  tutorId: string,
  limit = 50,
  database: DbLike = defaultDb,
): Promise<EarningRow[]> {
  const rows = (await database.execute(sql`
    select
      b.id::text as "bookingId",
      b.start_at_utc as "startAtUtc",
      b.duration_minutes as "durationMinutes",
      s.name as "studentName",
      b.status::text as status,
      b.price_cents as "priceCents",
      b.commission_bps as "commissionBps",
      coalesce((
        select sum(l.delta_cents)::int from ledger_entries l
        where l.booking_id = b.id and l.account = 'platform_revenue'
      ), 0) as "platformCents",
      coalesce((
        select sum(l.delta_cents)::int from ledger_entries l
        where l.booking_id = b.id and l.account in ('tutor_pending', 'tutor_available')
      ), 0) as "tutorCents",
      b.settled_at as "settledAt"
    from bookings b
    join users s on s.id = b.student_id
    where b.tutor_id = ${tutorId}::uuid
      and not b.is_trial
      and exists (select 1 from ledger_entries l where l.booking_id = b.id)
    order by b.start_at_utc desc
    limit ${limit}
  `)) as unknown as Record<string, unknown>[];

  // Raw SQL comes back as the driver's own shapes — timestamps as strings,
  // bigints as strings — so the rows are built rather than cast. A cast here
  // compiles and then throws "Invalid time value" in the middle of rendering.
  return rows.map((row) => ({
    bookingId: String(row.bookingId),
    startAtUtc: new Date(row.startAtUtc as string),
    durationMinutes: Number(row.durationMinutes),
    studentName: String(row.studentName ?? ''),
    status: String(row.status),
    priceCents: Number(row.priceCents),
    commissionBps: Number(row.commissionBps),
    platformCents: Number(row.platformCents),
    tutorCents: Number(row.tutorCents),
    settledAt: row.settledAt ? new Date(row.settledAt as string) : null,
  }));
}

export type EarningsSummary = {
  availableCents: number;
  pendingCents: number;
  lockedCents: number;
  lifetimeCents: number;
};

export async function earningsSummaryFor(
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<EarningsSummary> {
  const [row] = (await database.execute(sql`
    select
      t.available_cents::int as "availableCents",
      t.pending_cents::int as "pendingCents",
      t.payout_locked_cents::int as "lockedCents",
      -- Everything the tutor has ever been credited, from the ledger rather
      -- than from a running total somebody could forget to increment.
      coalesce((
        select sum(l.delta_cents) filter (where l.delta_cents > 0)::bigint
        from ledger_entries l
        where l.owner_id = t.user_id and l.account = 'tutor_pending'
      ), 0)::int as "lifetimeCents"
    from tutor_profiles t
    where t.user_id = ${tutorId}::uuid
  `)) as unknown as Record<string, unknown>[];

  return {
    availableCents: Number(row?.availableCents ?? 0),
    pendingCents: Number(row?.pendingCents ?? 0),
    lockedCents: Number(row?.lockedCents ?? 0),
    lifetimeCents: Number(row?.lifetimeCents ?? 0),
  };
}
