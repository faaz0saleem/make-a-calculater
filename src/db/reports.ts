/**
 * Reports, contact-info flags, and the graduated response (SPEC.md §8, §10).
 *
 * Three things share this file because they are one workflow: somebody (or
 * something) says a person did wrong, an admin reads it, and a step on the
 * ladder in `lib/moderation/sanctions.ts` may follow. The rule that holds all
 * of it together:
 *
 *   **Nothing here acts without an admin id.** There is no code path that
 *   issues a sanction, restricts an account, or resolves a report on a timer,
 *   a threshold, or a score. `recordContactFlag` writes a row for a person to
 *   look at and does nothing else, and it is the only function the message
 *   path calls.
 *
 * Every resolution writes an `admin_audit` row inside the same transaction as
 * the change, so a decision cannot exist without a record of who made it.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { notify } from './notifications';
import { hideReview } from './reviews';
import { contactFlags, reports, userSanctions } from './schema';
import { writeAudit, type AuditAction } from '@/lib/admin/audit';
import type { ContactIntent } from '@/lib/messaging/contact-intent';
import { findReportAction, type ReportAction } from '@/lib/moderation/reports';
import {
  nextSanctionLevel,
  restrictionEndsAt,
  SANCTION_COPY,
  type SanctionLevel,
} from '@/lib/moderation/sanctions';

export type Admin = { id: string; ip?: string | null };

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

export type FileReportInput = {
  reporterId: string;
  targetType: 'user' | 'tutor_profile' | 'booking' | 'review' | 'message';
  targetId: string;
  reason: string;
  body?: string | null;
};

/** File a report. Open to anyone signed in, about anything they can see. */
export async function fileReport(
  input: FileReportInput,
  database: DbLike = defaultDb,
): Promise<{ ok: true; reportId: string } | { ok: false; reason: string }> {
  if (!input.reason.trim()) return { ok: false, reason: 'Pick a reason.' };

  const [row] = await database
    .insert(reports)
    .values({
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason.slice(0, 120),
      body: input.body?.slice(0, 4_000) ?? null,
    })
    .returning({ id: reports.id });

  return { ok: true, reportId: row!.id };
}

// ---------------------------------------------------------------------------
// The report queue
// ---------------------------------------------------------------------------

export type ReportRow = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  body: string | null;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionAction: string | null;
  resolutionReason: string | null;
  reporterName: string | null;
  /** Who the report is about, as a name. */
  targetLabel: string | null;
  /** The account a sanction would land on, or null if the target is not a person. */
  subjectId: string | null;
  subjectName: string | null;
  /** How many confirmed steps that person already has. Decides the next rung. */
  priorSanctions: number;
  /** Where to go and look. */
  href: string | null;
};

/**
 * The queue, oldest first.
 *
 * The `subject_id` case is the load-bearing part: a report is filed against a
 * *thing* — a review, a message, a session — and a sanction lands on a
 * *person*, so the query resolves one to the other rather than making the admin
 * do it. A session report has no single subject (it could be either side), so
 * it resolves to null and the admin is sent to the dispute queue instead.
 */
export async function reportQueue(
  statuses: readonly string[] = ['open', 'reviewing'],
  limit = 50,
  database: DbLike = defaultDb,
): Promise<ReportRow[]> {
  const rows = (await database.execute(sql`
    with resolved as (
      select
        r.*,
        (select name from users where id = r.reporter_id) as reporter_name,
        case r.target_type
          when 'user' then r.target_id
          when 'tutor_profile' then r.target_id
          when 'message' then (select sender_id from messages where id = r.target_id)
          when 'review' then (select student_id from reviews where id = r.target_id)
          else null
        end as subject_id,
        case r.target_type
          when 'booking' then (
            select 'Session with ' || t.name
            from bookings b join users t on t.id = b.tutor_id
            where b.id = r.target_id
          )
          when 'review' then (
            select 'Review of ' || t.name
            from reviews rv join users t on t.id = rv.tutor_id
            where rv.id = r.target_id
          )
          when 'message' then (
            select 'Message from ' || u.name
            from messages m join users u on u.id = m.sender_id
            where m.id = r.target_id
          )
          else (select name from users where id = r.target_id)
        end as target_label,
        case r.target_type
          when 'tutor_profile' then '/tutors/' || r.target_id
          when 'message' then '/admin/moderation'
          when 'booking' then '/admin/moderation'
          else null
        end as href
      from reports r
      where r.status::text in (${sql.join(
        statuses.map((status) => sql`${status}`),
        sql`, `,
      )})
    )
    select
      resolved.*,
      (select name from users where id = resolved.subject_id) as subject_name,
      coalesce((
        select count(*) from user_sanctions s
        where s.user_id = resolved.subject_id and s.status <> 'lifted'
      ), 0)::int as prior_sanctions
    from resolved
    order by resolved.created_at
    limit ${limit}
  `)) as unknown as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    reason: String(row.reason),
    body: (row.body as string | null) ?? null,
    status: String(row.status),
    createdAt: new Date(row.created_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    resolutionAction: (row.resolution_action as string | null) ?? null,
    resolutionReason: (row.resolution_reason as string | null) ?? null,
    reporterName: (row.reporter_name as string | null) ?? null,
    targetLabel: (row.target_label as string | null) ?? null,
    subjectId: (row.subject_id as string | null) ?? null,
    subjectName: (row.subject_name as string | null) ?? null,
    priorSanctions: Number(row.prior_sanctions ?? 0),
    href: (row.href as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Sanctions
// ---------------------------------------------------------------------------

export type SanctionRow = {
  id: string;
  userId: string;
  level: SanctionLevel;
  reason: string;
  source: string;
  sourceId: string | null;
  issuedAt: Date;
  acknowledgedAt: Date | null;
  restrictedUntil: Date | null;
  status: string;
  appealNote: string | null;
  appealedAt: Date | null;
  appealDecidedAt: Date | null;
  appealOutcome: string | null;
};

const SANCTION_AUDIT: Record<SanctionLevel, AuditAction> = {
  warning: 'sanction.warn',
  restriction: 'sanction.restrict',
  review: 'sanction.review',
};

/**
 * Put somebody on the next rung.
 *
 * Takes an explicit level rather than working it out, because the admin is
 * shown which rung is next and may choose a gentler one — a first offence that
 * is obviously a misunderstanding should be able to end in nothing at all, and
 * a ladder that cannot be overridden by the person reading the message is not a
 * human-reviewed process.
 */
export async function issueSanction(
  input: {
    userId: string;
    level: SanctionLevel;
    reason: string;
    source: string;
    sourceId?: string | null;
  },
  admin: Admin,
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<{ ok: true; sanctionId: string } | { ok: false; reason: string }> {
  if (!input.reason.trim()) {
    return { ok: false, reason: 'A sanction needs a reason. The person reads it.' };
  }

  const run = async (tx: DbLike) => {
    const [row] = await tx
      .insert(userSanctions)
      .values({
        userId: input.userId,
        level: input.level,
        reason: input.reason.slice(0, 4_000),
        source: input.source,
        sourceId: input.sourceId ?? null,
        issuedBy: admin.id,
        issuedAt: now,
        restrictedUntil: input.level === 'restriction' ? restrictionEndsAt(now) : null,
      })
      .returning({ id: userSanctions.id });

    await writeAudit(tx, {
      actorId: admin.id,
      action: SANCTION_AUDIT[input.level],
      targetType: 'user',
      targetId: input.userId,
      after: { level: input.level, source: input.source, sourceId: input.sourceId ?? null },
      reason: input.reason,
      ip: admin.ip ?? null,
    });

    await notify(
      {
        userId: input.userId,
        kind: 'account_notice',
        title: SANCTION_COPY[input.level].title,
        body: SANCTION_COPY[input.level].consequence.slice(0, 400),
        href: '/settings/notices',
        dedupeKey: `sanction:${row!.id}`,
      },
      tx,
    );

    return { ok: true as const, sanctionId: row!.id };
  };

  return 'transaction' in database ? database.transaction((tx) => run(tx as DbLike)) : run(database);
}

export async function sanctionsFor(
  userId: string,
  database: DbLike = defaultDb,
): Promise<SanctionRow[]> {
  return database
    .select({
      id: userSanctions.id,
      userId: userSanctions.userId,
      level: userSanctions.level,
      reason: userSanctions.reason,
      source: userSanctions.source,
      sourceId: userSanctions.sourceId,
      issuedAt: userSanctions.issuedAt,
      acknowledgedAt: userSanctions.acknowledgedAt,
      restrictedUntil: userSanctions.restrictedUntil,
      status: userSanctions.status,
      appealNote: userSanctions.appealNote,
      appealedAt: userSanctions.appealedAt,
      appealDecidedAt: userSanctions.appealDecidedAt,
      appealOutcome: userSanctions.appealOutcome,
    })
    .from(userSanctions)
    .where(eq(userSanctions.userId, userId))
    .orderBy(desc(userSanctions.issuedAt)) as unknown as Promise<SanctionRow[]>;
}

/** The one waiting to be read, if any. Nothing is blocked by it; it is asked once. */
export async function pendingNoticeFor(
  userId: string,
  database: DbLike = defaultDb,
): Promise<SanctionRow | null> {
  const [row] = await database
    .select({
      id: userSanctions.id,
      userId: userSanctions.userId,
      level: userSanctions.level,
      reason: userSanctions.reason,
      source: userSanctions.source,
      sourceId: userSanctions.sourceId,
      issuedAt: userSanctions.issuedAt,
      acknowledgedAt: userSanctions.acknowledgedAt,
      restrictedUntil: userSanctions.restrictedUntil,
      status: userSanctions.status,
      appealNote: userSanctions.appealNote,
      appealedAt: userSanctions.appealedAt,
      appealDecidedAt: userSanctions.appealDecidedAt,
      appealOutcome: userSanctions.appealOutcome,
    })
    .from(userSanctions)
    .where(and(eq(userSanctions.userId, userId), isNull(userSanctions.acknowledgedAt)))
    .orderBy(userSanctions.issuedAt)
    .limit(1);

  return (row as SanctionRow | undefined) ?? null;
}

/** "I have read this." The row is scoped to the caller, so nobody clears anyone else's. */
export async function acknowledgeSanction(
  sanctionId: string,
  userId: string,
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<void> {
  await database
    .update(userSanctions)
    .set({ acknowledgedAt: now, status: 'acknowledged' })
    .where(and(eq(userSanctions.id, sanctionId), eq(userSanctions.userId, userId)));
}

/** Always appealable — including a warning, which is the one people dispute most. */
export async function appealSanction(
  sanctionId: string,
  userId: string,
  note: string,
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  if (!note.trim()) return { ok: false, reason: 'Tell us what we got wrong.' };

  await database
    .update(userSanctions)
    .set({
      appealNote: note.slice(0, 4_000),
      appealedAt: now,
      status: 'appealed',
      // Appealing counts as having read it.
      acknowledgedAt: sql`coalesce(${userSanctions.acknowledgedAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(and(eq(userSanctions.id, sanctionId), eq(userSanctions.userId, userId)));

  return { ok: true };
}

/**
 * Answer an appeal.
 *
 * `lifted` ends a restriction immediately — `isRestricted` ignores a lifted row
 * — and leaves the record in place, because deleting the history of a decision
 * we got wrong is how the same mistake happens twice.
 */
export async function decideAppeal(
  sanctionId: string,
  admin: Admin,
  decision: { uphold: boolean; outcome: string },
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  if (!decision.outcome.trim()) {
    return { ok: false, reason: 'The person reads this. Say why.' };
  }

  const run = async (tx: DbLike) => {
    const [before] = await tx
      .select({ userId: userSanctions.userId, level: userSanctions.level, status: userSanctions.status })
      .from(userSanctions)
      .where(eq(userSanctions.id, sanctionId))
      .limit(1);

    if (!before) return { ok: false, reason: 'No such notice.' };

    await tx
      .update(userSanctions)
      .set({
        status: decision.uphold ? 'upheld' : 'lifted',
        appealDecidedBy: admin.id,
        appealDecidedAt: now,
        appealOutcome: decision.outcome.slice(0, 4_000),
      })
      .where(eq(userSanctions.id, sanctionId));

    await writeAudit(tx, {
      actorId: admin.id,
      action: decision.uphold ? 'sanction.appeal.uphold' : 'sanction.appeal.lift',
      targetType: 'user_sanction',
      targetId: sanctionId,
      before: { status: before.status },
      after: { status: decision.uphold ? 'upheld' : 'lifted' },
      reason: decision.outcome,
      ip: admin.ip ?? null,
    });

    await notify(
      {
        userId: before.userId,
        kind: 'account_notice',
        title: decision.uphold ? 'Your appeal was not upheld' : 'Your appeal was upheld',
        body: decision.outcome.slice(0, 400),
        href: '/settings/notices',
        dedupeKey: `appeal:${sanctionId}`,
      },
      tx,
    );

    return { ok: true };
  };

  return 'transaction' in database ? database.transaction((tx) => run(tx as DbLike)) : run(database);
}

export type AppealRow = SanctionRow & { userName: string | null };

/** Appeals waiting for an answer, oldest first. Nobody should wait long. */
export async function appealQueue(
  limit = 30,
  database: DbLike = defaultDb,
): Promise<AppealRow[]> {
  const rows = (await database.execute(sql`
    select s.*, u.name as user_name
    from user_sanctions s
    join users u on u.id = s.user_id
    where s.status = 'appealed'
    order by s.appealed_at
    limit ${limit}
  `)) as unknown as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    userName: (row.user_name as string | null) ?? null,
    level: row.level as SanctionLevel,
    reason: String(row.reason),
    source: String(row.source),
    sourceId: (row.source_id as string | null) ?? null,
    issuedAt: new Date(row.issued_at as string),
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at as string) : null,
    restrictedUntil: row.restricted_until ? new Date(row.restricted_until as string) : null,
    status: String(row.status),
    appealNote: (row.appeal_note as string | null) ?? null,
    appealedAt: row.appealed_at ? new Date(row.appealed_at as string) : null,
    appealDecidedAt: row.appeal_decided_at ? new Date(row.appeal_decided_at as string) : null,
    appealOutcome: (row.appeal_outcome as string | null) ?? null,
  }));
}

/**
 * Is this person under a live restriction?
 *
 * One indexed lookup, asked at the two places a restriction means anything —
 * a new trial request, and the ranking job. Everywhere else in the product this
 * question is not asked, because everywhere else the answer would not change
 * what happens.
 */
export async function isUserRestricted(
  userId: string,
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<boolean> {
  const rows = (await database.execute(sql`
    select 1
    from user_sanctions
    where user_id = ${userId}::uuid
      and level = 'restriction'
      and status <> 'lifted'
      and restricted_until > ${now.toISOString()}::timestamptz
    limit 1
  `)) as unknown as unknown[];

  return rows.length > 0;
}

/** The same question for a whole batch, so the nightly ranking job asks once. */
export async function restrictedUserIds(
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<Set<string>> {
  const rows = (await database.execute(sql`
    select distinct user_id
    from user_sanctions
    where level = 'restriction'
      and status <> 'lifted'
      and restricted_until > ${now.toISOString()}::timestamptz
  `)) as unknown as { user_id: string }[];

  return new Set(rows.map((row) => row.user_id));
}

// ---------------------------------------------------------------------------
// Resolving a report
// ---------------------------------------------------------------------------

/**
 * Close a report with an action and a reason.
 *
 * The sanction, the report row and the audit entry land in one transaction. A
 * report resolved as `warned` where the warning failed to write would be a
 * report that says somebody was warned and a person who was never told.
 */
export async function resolveReport(
  input: {
    reportId: string;
    action: ReportAction;
    reason: string;
    /** Present only when the action carries a sanction. */
    subjectId?: string | null;
  },
  admin: Admin,
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const action = findReportAction(input.action);
  if (!action) return { ok: false, reason: 'Unknown action.' };
  if (!input.reason.trim()) return { ok: false, reason: 'Every resolution needs a reason.' };

  const run = async (tx: DbLike): Promise<{ ok: boolean; reason?: string }> => {
    const [report] = await tx
      .select({
        id: reports.id,
        status: reports.status,
        targetType: reports.targetType,
        targetId: reports.targetId,
      })
      .from(reports)
      .where(eq(reports.id, input.reportId))
      .for('update')
      .limit(1);

    if (!report) return { ok: false, reason: 'No such report.' };
    if (report.status === 'resolved' || report.status === 'dismissed') {
      return { ok: false, reason: 'That report has already been dealt with.' };
    }

    if (input.action === 'content_removed') {
      if (report.targetType !== 'review') {
        return { ok: false, reason: 'There is no review on this report to hide.' };
      }

      // Writes its own `review.hide` audit row alongside the `report.resolve`
      // one below, because they are two different facts.
      const hidden = await hideReview(report.targetId, admin, input.reason, now, tx);
      if (!hidden.ok) {
        return { ok: false, reason: 'That review could not be hidden — it may already be.' };
      }
    }

    if (action.sanction) {
      if (!input.subjectId) {
        return { ok: false, reason: 'There is no single person to sanction on this report.' };
      }

      const issued = await issueSanction(
        {
          userId: input.subjectId,
          level: action.sanction,
          reason: input.reason,
          source: 'report',
          sourceId: report.id,
        },
        admin,
        tx,
        now,
      );

      if (!issued.ok) return issued;
    }

    await tx
      .update(reports)
      .set({
        status: input.action === 'dismissed' ? 'dismissed' : 'resolved',
        resolvedAt: now,
        resolvedBy: admin.id,
        resolutionAction: input.action,
        resolutionReason: input.reason.slice(0, 4_000),
      })
      .where(eq(reports.id, report.id));

    await writeAudit(tx, {
      actorId: admin.id,
      action: 'report.resolve',
      targetType: 'report',
      targetId: report.id,
      before: { status: report.status },
      after: { status: input.action === 'dismissed' ? 'dismissed' : 'resolved', action: input.action },
      reason: input.reason,
      ip: admin.ip ?? null,
    });

    return { ok: true };
  };

  return 'transaction' in database ? database.transaction((tx) => run(tx as DbLike)) : run(database);
}

// ---------------------------------------------------------------------------
// Contact-info flags
// ---------------------------------------------------------------------------

/**
 * Record that a message scored high enough for somebody to read it.
 *
 * This is the *entire* automatic response to a contact-info attempt. It writes
 * a row. It does not warn, restrict, hide, block, delay or notify anybody. The
 * message has already been sent by the time this runs, and it stays sent.
 */
export async function recordContactFlag(
  input: { messageId: string; threadId: string; senderId: string; intent: ContactIntent },
  database: DbLike = defaultDb,
): Promise<void> {
  await database
    .insert(contactFlags)
    .values({
      messageId: input.messageId,
      threadId: input.threadId,
      senderId: input.senderId,
      score: input.intent.score,
      band: input.intent.band,
      signals: input.intent.signals,
    })
    .onConflictDoNothing();
}

export type ContactFlagRow = {
  id: string;
  messageId: string;
  threadId: string;
  senderId: string;
  senderName: string | null;
  score: number;
  band: string;
  signals: { id: string; weight: number; note: string }[];
  status: string;
  createdAt: Date;
  /** What everyone saw. */
  masked: string;
  /** What was typed. Admin only — see `db/moderation.ts` for the rule. */
  raw: string;
  /** Confirmed steps this person already has, deciding the next rung. */
  priorConfirmed: number;
  /** The rung the ladder would offer next. The admin may choose otherwise. */
  suggested: SanctionLevel;
};

/** The queue, highest confidence first. */
export async function contactFlagQueue(
  status = 'pending',
  limit = 50,
  database: DbLike = defaultDb,
): Promise<ContactFlagRow[]> {
  const rows = (await database.execute(sql`
    select
      f.id, f.message_id, f.thread_id, f.sender_id, f.score, f.band, f.signals,
      f.status, f.created_at,
      u.name as sender_name,
      m.body_masked as masked,
      m.body_raw as raw,
      (
        select count(*) from contact_flags prior
        where prior.sender_id = f.sender_id
          and prior.status = 'confirmed'
          and prior.created_at < f.created_at
      )::int as prior_confirmed
    from contact_flags f
    join messages m on m.id = f.message_id
    join users u on u.id = f.sender_id
    where f.status = ${status}::contact_flag_status
    order by f.score desc, f.created_at
    limit ${limit}
  `)) as unknown as Record<string, unknown>[];

  return rows.map((row) => {
    const priorConfirmed = Number(row.prior_confirmed ?? 0);
    return {
      id: String(row.id),
      messageId: String(row.message_id),
      threadId: String(row.thread_id),
      senderId: String(row.sender_id),
      senderName: (row.sender_name as string | null) ?? null,
      score: Number(row.score),
      band: String(row.band),
      signals: (row.signals as ContactFlagRow['signals']) ?? [],
      status: String(row.status),
      createdAt: new Date(row.created_at as string),
      masked: String(row.masked ?? ''),
      raw: String(row.raw ?? ''),
      priorConfirmed,
      suggested: nextSanctionLevel(priorConfirmed),
    };
  });
}

/**
 * An admin's verdict on a flag.
 *
 * Dismissing is the common case and costs nothing — it is meant to be the
 * cheap option, because a queue where dismissing feels like admitting a mistake
 * is a queue that over-punishes.
 */
export async function decideContactFlag(
  input: {
    flagId: string;
    confirm: boolean;
    /** Null means "confirmed, but no sanction this time". */
    level?: SanctionLevel | null;
    reason: string;
  },
  admin: Admin,
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const run = async (tx: DbLike): Promise<{ ok: boolean; reason?: string }> => {
    const [flag] = await tx
      .select({ id: contactFlags.id, senderId: contactFlags.senderId, status: contactFlags.status })
      .from(contactFlags)
      .where(eq(contactFlags.id, input.flagId))
      .for('update')
      .limit(1);

    if (!flag) return { ok: false, reason: 'No such flag.' };
    if (flag.status !== 'pending') return { ok: false, reason: 'Somebody has already reviewed this.' };

    if (input.confirm && input.level) {
      if (!input.reason.trim()) {
        return { ok: false, reason: 'A sanction needs a reason. The person reads it.' };
      }

      const issued = await issueSanction(
        {
          userId: flag.senderId,
          level: input.level,
          reason: input.reason,
          source: 'contact_flag',
          sourceId: flag.id,
        },
        admin,
        tx,
        now,
      );

      if (!issued.ok) return issued;
    }

    await tx
      .update(contactFlags)
      .set({
        status: input.confirm ? 'confirmed' : 'dismissed',
        reviewedBy: admin.id,
        reviewedAt: now,
      })
      .where(eq(contactFlags.id, flag.id));

    await writeAudit(tx, {
      actorId: admin.id,
      action: input.confirm ? 'contact_flag.confirm' : 'contact_flag.dismiss',
      targetType: 'contact_flag',
      targetId: flag.id,
      after: { level: input.confirm ? (input.level ?? null) : null },
      reason: input.reason || null,
      ip: admin.ip ?? null,
    });

    return { ok: true };
  };

  return 'transaction' in database ? database.transaction((tx) => run(tx as DbLike)) : run(database);
}

// ---------------------------------------------------------------------------
// The behavioural signal
// ---------------------------------------------------------------------------

/** Sessions a pair must complete before going quiet means anything. */
export const QUIET_AFTER_SESSIONS = 3;
/** How long silence has to last. Shorter than this is a holiday. */
export const QUIET_DAYS = 45;

export type QuietPairSignal = {
  tutorId: string;
  tutorName: string | null;
  /** Pairs that completed enough sessions and then stopped, together. */
  quietPairs: number;
  /** Pairs that completed enough sessions and are still booking. */
  activePairs: number;
  /** Quiet as a share of all established pairs, in basis points. */
  quietBps: number;
  /** What those quiet pairs were worth before they stopped. */
  lostGmvCents: number;
};

/**
 * Pairs that got established and then both went silent.
 *
 * A student and a tutor who complete three sessions and then stop booking, with
 * neither of them booking anyone else, is the shape of a relationship that
 * carried on somewhere we cannot see. One pair is a student who passed their
 * exam. A tutor with eleven of them and two that stayed is a pattern.
 *
 * This is why it is reported **per tutor across many students**, and why the
 * number that matters is the ratio rather than the count — a tutor with a
 * hundred students will have more quiet pairs than one with five, and that on
 * its own means nothing.
 *
 * It is a signal, not a finding: it goes on a screen for a person to read
 * beside the tutor's messages and reviews. Nothing acts on it.
 */
export async function quietPairSignals(
  limit = 15,
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<QuietPairSignal[]> {
  const rows = (await database.execute(sql`
    with pairs as (
      select
        b.tutor_id,
        b.student_id,
        count(*) filter (where b.status = 'settled' and not b.is_trial)::int as sessions,
        -- The last one that actually happened. Taking the max over every row
        -- would let a cancelled booking from last week hide six months of
        -- silence.
        max(b.start_at_utc) filter (where b.status = 'settled') as last_session,
        coalesce(sum(b.price_cents) filter (where b.status = 'settled'), 0)::bigint as spent
      from bookings b
      group by b.tutor_id, b.student_id
    ),
    established as (
      select * from pairs where sessions >= ${QUIET_AFTER_SESSIONS}
    ),
    judged as (
      select
        e.*,
        (
          e.last_session < ${now.toISOString()}::timestamptz - (${QUIET_DAYS} || ' days')::interval
          -- and the student has not simply moved to another tutor here, which
          -- would be churn rather than a relationship leaving the platform.
          and not exists (
            select 1 from bookings other
            where other.student_id = e.student_id
              and other.tutor_id <> e.tutor_id
              and other.start_at_utc > e.last_session
          )
        ) as quiet
      from established e
    )
    select
      j.tutor_id,
      u.name as tutor_name,
      count(*) filter (where j.quiet)::int as quiet_pairs,
      count(*) filter (where not j.quiet)::int as active_pairs,
      coalesce(sum(j.spent) filter (where j.quiet), 0)::bigint as lost_gmv
    from judged j
    join users u on u.id = j.tutor_id
    group by j.tutor_id, u.name
    having count(*) filter (where j.quiet) > 0
    order by quiet_pairs desc, lost_gmv desc
    limit ${limit}
  `)) as unknown as Record<string, unknown>[];

  return rows.map((row) => {
    const quiet = Number(row.quiet_pairs ?? 0);
    const active = Number(row.active_pairs ?? 0);
    const total = quiet + active;

    return {
      tutorId: String(row.tutor_id),
      tutorName: (row.tutor_name as string | null) ?? null,
      quietPairs: quiet,
      activePairs: active,
      quietBps: total > 0 ? Math.round((quiet * 10_000) / total) : 0,
      lostGmvCents: Number(row.lost_gmv ?? 0),
    };
  });
}
