/**
 * The numbers the admin dashboard reports (SPEC.md §10).
 *
 * All the SQL lives here so the page is presentation and nothing else. Two
 * things in this file are worth more than the rest put together:
 *
 *  - **The float.** Credits sold is cash we have taken; credits outstanding is
 *    tutoring we owe and have not yet delivered. A marketplace that reads the
 *    first number as revenue and forgets the second one is a marketplace that
 *    spends its own liability.
 *  - **Unmatched demand.** Every curriculum position a student has declared
 *    that no verified tutor teaches. It is the recruiting list, and it is the
 *    only number here that says what to do next rather than what happened.
 *
 * Everything is derived from the ledger or from the rows the ledger reconciles
 * against. Nothing here recomputes money from today's constants.
 */

import { sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import {
  ABSORBED_FAILURE_WINDOW_DAYS,
  MAX_ABSORBED_FAILURES_PER_STUDENT,
} from '@/lib/money/outcomes';
import { findMethod, PAYMENT_METHODS, providerFeeCents } from '@/lib/payments/catalogue';

/** Postgres hands back `bigint` as a string; every count here goes through this. */
function n(value: unknown): number {
  return Number(value ?? 0);
}

function bps(part: number, whole: number): number {
  return whole > 0 ? Math.round((part * 10_000) / whole) : 0;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export type MoneyOverview = {
  gmvCents: number;
  platformRevenueCents: number;
  takeRateBps: number;
  /** Cash taken for credits. */
  creditsSoldCents: number;
  /** Spending power issued — cash plus whatever bonus the pack carried. */
  creditsIssuedCents: number;
  bonusIssuedCents: number;
  /** Issued minus what is still sitting in wallets. */
  creditsConsumedCents: number;
  /** The float. Money taken for tutoring that has not happened yet. */
  creditsOutstandingCents: number;
  escrowCents: number;
  payoutLiabilityCents: number;
  paidOutCents: number;
  lockedForPayoutCents: number;
};

export async function moneyOverview(database: DbLike = defaultDb): Promise<MoneyOverview> {
  const [row] = (await database.execute(sql`
    select
      coalesce((select sum(price_cents) from bookings where status = 'settled'), 0)::bigint as gmv,
      coalesce((select balance_cents from platform_accounts where account = 'platform_revenue'), 0)::bigint as revenue,
      coalesce((select sum(paid_cents) from credit_purchases where status = 'paid'), 0)::bigint as sold,
      coalesce((select sum(credits_cents) from credit_purchases where status = 'paid'), 0)::bigint as issued,
      coalesce((select sum(credits_cents) from student_wallets), 0)::bigint as outstanding,
      coalesce((select sum(escrow_cents) from bookings), 0)::bigint as escrow,
      coalesce((select sum(available_cents + pending_cents + payout_locked_cents) from tutor_profiles), 0)::bigint as owed,
      coalesce((select sum(payout_locked_cents) from tutor_profiles), 0)::bigint as locked,
      coalesce((select sum(amount_cents) from payouts where status = 'paid'), 0)::bigint as paid_out
  `)) as unknown as Record<string, unknown>[];

  const gmvCents = n(row?.gmv);
  const platformRevenueCents = n(row?.revenue);
  const creditsSoldCents = n(row?.sold);
  const creditsIssuedCents = n(row?.issued);
  const creditsOutstandingCents = n(row?.outstanding);

  return {
    gmvCents,
    platformRevenueCents,
    takeRateBps: bps(platformRevenueCents, gmvCents),
    creditsSoldCents,
    creditsIssuedCents,
    bonusIssuedCents: creditsIssuedCents - creditsSoldCents,
    // Credits leave a wallet only by being spent, and come back only on a
    // refund, so the difference is exactly what has been consumed.
    creditsConsumedCents: creditsIssuedCents - creditsOutstandingCents,
    creditsOutstandingCents,
    escrowCents: n(row?.escrow),
    payoutLiabilityCents: n(row?.owed),
    paidOutCents: n(row?.paid_out),
    lockedForPayoutCents: n(row?.locked),
  };
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export type PackMargin = {
  packId: string;
  name: string;
  purchases: number;
  cashInCents: number;
  creditsIssuedCents: number;
  bonusCents: number;
  providerFeesCents: number;
  /** What the credits will cost us in tutor pay, at the blended take rate. */
  tutorCostCents: number;
  marginCents: number;
  marginBps: number;
};

/**
 * What each pack is actually worth to us.
 *
 * Not "cash in": a pack is a promise of tutoring, and the tutoring costs
 * whatever the tutor keeps. So a pack earns its price, minus what the payment
 * provider takes, minus the tutor's share of everything the credits will buy —
 * bonus credits included, which is exactly what makes a generous bonus tier
 * expensive.
 *
 * The tutor's share is the blended rate we have really been charging, read
 * from settled bookings, rather than the headline commission. A page that used
 * the headline would flatter every row.
 */
export async function packMargins(database: DbLike = defaultDb): Promise<{
  rows: PackMargin[];
  takeRateBps: number;
}> {
  const [rate] = (await database.execute(sql`
    select
      coalesce((select balance_cents from platform_accounts where account = 'platform_revenue'), 0)::bigint as revenue,
      coalesce((select sum(price_cents) from bookings where status = 'settled'), 0)::bigint as gmv
  `)) as unknown as Record<string, unknown>[];

  const takeRateBps = bps(n(rate?.revenue), n(rate?.gmv));

  // Grouped by pack *and* provider, because the fee is a property of the
  // provider and a $5 pack costs 75c through a card and 13c through a wallet.
  const rows = (await database.execute(sql`
    select
      p.id as pack_id,
      p.name,
      cp.provider,
      count(*)::int as purchases,
      coalesce(sum(cp.paid_cents), 0)::bigint as cash_in,
      coalesce(sum(cp.credits_cents), 0)::bigint as credits_issued,
      array_agg(cp.paid_cents) as paid_amounts
    from credit_packs p
    join credit_purchases cp on cp.pack_id = p.id and cp.status = 'paid'
    group by p.id, p.name, p.sort_order, cp.provider
    order by p.sort_order, cp.provider
  `)) as unknown as {
    pack_id: string;
    name: string;
    provider: string;
    purchases: number;
    cash_in: string;
    credits_issued: string;
    paid_amounts: number[];
  }[];

  const byPack = new Map<string, PackMargin>();

  for (const row of rows) {
    const method = findMethod(row.provider);
    // The fee is per transaction, not per dollar, so it has to be summed one
    // purchase at a time — a fixed 50c on twenty $5 packs is $10, not 50c.
    const fees = method
      ? row.paid_amounts.reduce((total, paid) => total + providerFeeCents(method, n(paid)), 0)
      : 0;

    const existing = byPack.get(row.pack_id) ?? {
      packId: row.pack_id,
      name: row.name,
      purchases: 0,
      cashInCents: 0,
      creditsIssuedCents: 0,
      bonusCents: 0,
      providerFeesCents: 0,
      tutorCostCents: 0,
      marginCents: 0,
      marginBps: 0,
    };

    existing.purchases += row.purchases;
    existing.cashInCents += n(row.cash_in);
    existing.creditsIssuedCents += n(row.credits_issued);
    existing.providerFeesCents += fees;
    byPack.set(row.pack_id, existing);
  }

  const out = [...byPack.values()].map((pack) => {
    pack.bonusCents = pack.creditsIssuedCents - pack.cashInCents;
    pack.tutorCostCents = Math.round((pack.creditsIssuedCents * (10_000 - takeRateBps)) / 10_000);
    pack.marginCents = pack.cashInCents - pack.providerFeesCents - pack.tutorCostCents;
    pack.marginBps = bps(pack.marginCents, pack.cashInCents);
    return pack;
  });

  return { rows: out, takeRateBps };
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export type ProviderSplit = {
  provider: string;
  label: string;
  purchases: number;
  cashInCents: number;
  feesCents: number;
  shareBps: number;
};

/** Card against local rails: which one students actually reach for. */
export async function providerSplit(database: DbLike = defaultDb): Promise<ProviderSplit[]> {
  const rows = (await database.execute(sql`
    select
      provider,
      count(*)::int as purchases,
      coalesce(sum(paid_cents), 0)::bigint as cash_in,
      array_agg(paid_cents) as paid_amounts
    from credit_purchases
    where status = 'paid'
    group by provider
    order by cash_in desc
  `)) as unknown as {
    provider: string;
    purchases: number;
    cash_in: string;
    paid_amounts: number[];
  }[];

  const total = rows.reduce((sum, row) => sum + n(row.cash_in), 0);

  return rows.map((row) => {
    const method = findMethod(row.provider);
    return {
      provider: row.provider,
      label: method?.label ?? row.provider,
      purchases: row.purchases,
      cashInCents: n(row.cash_in),
      feesCents: method
        ? row.paid_amounts.reduce((sum, paid) => sum + providerFeeCents(method, n(paid)), 0)
        : 0,
      shareBps: bps(n(row.cash_in), total),
    };
  });
}

/** Every configured rail, including the ones nobody has used. */
export function unusedProviders(split: ProviderSplit[]): string[] {
  const used = new Set(split.map((row) => row.provider));
  return PAYMENT_METHODS.filter((method) => !used.has(method.id)).map((method) => method.label);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type Operations = {
  activeTutors: number;
  pendingVerifications: number;
  sessionsCompleted: number;
  bookingsTerminal: number;
  cancelledByStudent: number;
  cancelledByTutor: number;
  noShowStudent: number;
  noShowTutor: number;
  cancellationStudentBps: number;
  cancellationTutorBps: number;
  trials: number;
  trialsConverted: number;
  trialToPaidBps: number;
  absorbedFailures: number;
  studentsAtCap: number;
  openReports: number;
};

export async function operations(database: DbLike = defaultDb): Promise<Operations> {
  const [row] = (await database.execute(sql`
    with terminal as (
      select status from bookings
      where status in ('settled', 'cancelled_by_student', 'cancelled_by_tutor', 'expired',
                       'refunded', 'no_show_student', 'no_show_tutor')
        and not is_trial
    ),
    -- A trial converted when that same student later paid this same tutor.
    -- Pair-level, not student-level: a student who tried five tutors and paid
    -- one converted once, not five times.
    trial_pairs as (
      select
        t.student_id,
        t.tutor_id,
        exists (
          select 1 from bookings paid
          where paid.tutor_id = t.tutor_id
            and paid.student_id = t.student_id
            and not paid.is_trial
            and paid.start_at_utc > t.start_at_utc
        ) as converted
      from bookings t
      where t.is_trial and t.status in ('settled', 'completed')
    ),
    absorbed as (
      select b.student_id, count(*)::int as failures
      from ledger_entries l
      join bookings b on b.id = l.booking_id
      where l.reason = 'technical_failure_absorbed:absorbed'
        and l.at >= now() - (${ABSORBED_FAILURE_WINDOW_DAYS} || ' days')::interval
      group by b.student_id
    )
    select
      (select count(*) from tutor_profiles where status = 'verified')::int as active_tutors,
      (select count(*) from tutor_profiles where status = 'pending_review')::int as pending_verifications,
      (select count(*) from bookings where status = 'settled')::int as sessions_completed,
      (select count(*) from terminal)::int as bookings_terminal,
      (select count(*) from terminal where status = 'cancelled_by_student')::int as cancelled_student,
      (select count(*) from terminal where status = 'cancelled_by_tutor')::int as cancelled_tutor,
      (select count(*) from terminal where status = 'no_show_student')::int as no_show_student,
      (select count(*) from terminal where status = 'no_show_tutor')::int as no_show_tutor,
      (select count(*) from trial_pairs)::int as trials,
      (select count(*) from trial_pairs where converted)::int as trials_converted,
      (select coalesce(sum(failures), 0) from absorbed)::int as absorbed_failures,
      (select count(*) from absorbed where failures >= ${MAX_ABSORBED_FAILURES_PER_STUDENT})::int as students_at_cap,
      (select count(*) from reports where status in ('open', 'reviewing'))::int as open_reports
  `)) as unknown as Record<string, unknown>[];

  const terminal = n(row?.bookings_terminal);
  const trials = n(row?.trials);
  const converted = n(row?.trials_converted);

  return {
    activeTutors: n(row?.active_tutors),
    pendingVerifications: n(row?.pending_verifications),
    sessionsCompleted: n(row?.sessions_completed),
    bookingsTerminal: terminal,
    cancelledByStudent: n(row?.cancelled_student),
    cancelledByTutor: n(row?.cancelled_tutor),
    noShowStudent: n(row?.no_show_student),
    noShowTutor: n(row?.no_show_tutor),
    cancellationStudentBps: bps(n(row?.cancelled_student), terminal),
    cancellationTutorBps: bps(n(row?.cancelled_tutor), terminal),
    trials,
    trialsConverted: converted,
    trialToPaidBps: bps(converted, trials),
    absorbedFailures: n(row?.absorbed_failures),
    studentsAtCap: n(row?.students_at_cap),
    openReports: n(row?.open_reports),
  };
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

export type SubjectRow = { subject: string; sessions: number; gmvCents: number };

export async function topSubjects(limit = 8, database: DbLike = defaultDb): Promise<SubjectRow[]> {
  const rows = (await database.execute(sql`
    select s.name as subject,
           count(*)::int as sessions,
           coalesce(sum(b.price_cents), 0)::bigint as gmv
    from bookings b
    join subjects s on s.id = b.subject_id
    where b.status = 'settled'
    group by s.name
    order by gmv desc
    limit ${limit}
  `)) as unknown as { subject: string; sessions: number; gmv: string }[];

  return rows.map((row) => ({ subject: row.subject, sessions: row.sessions, gmvCents: n(row.gmv) }));
}

export type PositionRow = {
  board: string;
  level: string;
  subject: string;
  students: number;
  tutors: number;
};

/** What students say they are studying, and how many verified tutors cover it. */
export async function topCurriculumPositions(
  limit = 10,
  database: DbLike = defaultDb,
): Promise<PositionRow[]> {
  const rows = (await database.execute(sql`
    select
      bd.name as board,
      cl.name as level,
      s.name as subject,
      count(distinct sc.student_id)::int as students,
      (
        select count(*)
        from tutor_curriculum tc
        join tutor_profiles tp on tp.user_id = tc.tutor_id and tp.status = 'verified'
        where tc.board_id = sc.board_id and tc.level_id = sc.level_id and tc.subject_id = sc.subject_id
      )::int as tutors
    from student_curriculum sc
    join boards bd on bd.id = sc.board_id
    join curriculum_levels cl on cl.id = sc.level_id
    join subjects s on s.id = sc.subject_id
    group by bd.name, cl.name, s.name, sc.board_id, sc.level_id, sc.subject_id
    order by students desc, board, level
    limit ${limit}
  `)) as unknown as PositionRow[];

  return rows;
}

export type UnmatchedRow = PositionRow & {
  /** Tutors teaching this subject at the same stage under a *different* board. */
  nearTutors: number;
};

export type UnmatchedDemand = {
  rows: UnmatchedRow[];
  /** Distinct positions students have declared. */
  positionsDeclared: number;
  positionsUnmatched: number;
  studentsAffected: number;
};

/**
 * Curriculum positions students have declared that no verified tutor teaches.
 *
 * This is the recruiting list. `nearTutors` is what makes it actionable: a
 * position with nobody at all needs hiring, while one with six tutors teaching
 * the same subject at the same stage under another board needs a conversation —
 * they may already be able to teach it and simply have not said so.
 */
export async function unmatchedDemand(
  limit = 12,
  database: DbLike = defaultDb,
): Promise<UnmatchedDemand> {
  const rows = (await database.execute(sql`
    select
      bd.name as board,
      cl.name as level,
      s.name as subject,
      count(distinct sc.student_id)::int as students,
      0::int as tutors,
      (
        select count(distinct tc.tutor_id)
        from tutor_curriculum tc
        join tutor_profiles tp on tp.user_id = tc.tutor_id and tp.status = 'verified'
        join curriculum_levels near on near.id = tc.level_id and near.board_id = tc.board_id
        where tc.subject_id = sc.subject_id
          and near.stage = cl.stage
          and tc.board_id <> sc.board_id
      )::int as near_tutors
    from student_curriculum sc
    join boards bd on bd.id = sc.board_id
    join curriculum_levels cl on cl.id = sc.level_id and cl.board_id = sc.board_id
    join subjects s on s.id = sc.subject_id
    where not exists (
      select 1
      from tutor_curriculum tc
      join tutor_profiles tp on tp.user_id = tc.tutor_id and tp.status = 'verified'
      where tc.board_id = sc.board_id
        and tc.level_id = sc.level_id
        and tc.subject_id = sc.subject_id
    )
    group by bd.name, cl.name, cl.stage, s.name, sc.board_id, sc.level_id, sc.subject_id
    order by students desc, near_tutors desc
    limit ${limit}
  `)) as unknown as (UnmatchedRow & { near_tutors: number })[];

  const [totals] = (await database.execute(sql`
    with declared as (
      select distinct board_id, level_id, subject_id from student_curriculum
    ),
    unmatched as (
      select d.* from declared d
      where not exists (
        select 1
        from tutor_curriculum tc
        join tutor_profiles tp on tp.user_id = tc.tutor_id and tp.status = 'verified'
        where tc.board_id = d.board_id and tc.level_id = d.level_id and tc.subject_id = d.subject_id
      )
    )
    select
      (select count(*) from declared)::int as declared,
      (select count(*) from unmatched)::int as unmatched,
      (
        select count(distinct sc.student_id)
        from student_curriculum sc
        join unmatched u
          on u.board_id = sc.board_id and u.level_id = sc.level_id and u.subject_id = sc.subject_id
      )::int as students_affected
  `)) as unknown as Record<string, unknown>[];

  return {
    rows: rows.map((row) => ({
      board: row.board,
      level: row.level,
      subject: row.subject,
      students: row.students,
      tutors: 0,
      nearTutors: n(row.near_tutors),
    })),
    positionsDeclared: n(totals?.declared),
    positionsUnmatched: n(totals?.unmatched),
    studentsAffected: n(totals?.students_affected),
  };
}
