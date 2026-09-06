/**
 * Recording what we do not have, and what is nearest to it (SPEC.md §4, §10).
 *
 * Two jobs, and they belong together because the answer to "nobody teaches
 * that" has to be both — a person needs somewhere to go now, and we need to
 * know they asked so the next tutor recruited is the right one.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { curriculumInterest, subjects, tutorCurriculum, tutorProfiles, users } from './schema';
import { logEvent } from '@/lib/observability/log';

export type Position = { boardId: string; levelId: string; subjectId: string };

/**
 * Somebody looked for this and found nothing.
 *
 * Anonymous is allowed and is the important case: at launch, most people
 * looking are not signed in, and requiring an account first would mean never
 * learning what they wanted. Repeats on the same day are one row, so a
 * refreshed page is one piece of demand.
 */
export async function recordCurriculumInterest(
  position: Position,
  userId: string | null,
  database: DbLike = defaultDb,
): Promise<void> {
  try {
    await database
      .insert(curriculumInterest)
      .values({
        userId,
        boardId: position.boardId,
        levelId: position.levelId,
        subjectId: position.subjectId,
      })
      .onConflictDoNothing();

    logEvent('demand.unmatched', { ...position, userId, severity: 'info' });
  } catch (error) {
    // Losing a demand signal must never cost somebody their page.
    logEvent('demand.record_failed', {
      severity: 'warn',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type NearestOption = {
  label: string;
  /** What the feed should be filtered to instead. */
  filters: { board?: string; level?: string; subject?: string };
  tutors: number;
};

/**
 * The nearest things somebody could actually book.
 *
 * Ordered by how small a compromise each one is: the same class on another
 * board is a syllabus difference; the same subject at another class is a
 * teaching-level difference; the subject alone is the last resort. Only options
 * with a real tutor behind them are offered — a suggestion that leads to a
 * second empty page is worse than none.
 */
export async function nearestPositions(
  position: Position,
  database: DbLike = defaultDb,
): Promise<NearestOption[]> {
  const [context] = (await database.execute(sql`
    select
      (select name from subjects where id = ${position.subjectId}::uuid) as subject_name,
      (select slug from subjects where id = ${position.subjectId}::uuid) as subject_slug,
      cl.name as level_name,
      cl.stage as stage
    from curriculum_levels cl
    where cl.board_id = ${position.boardId} and cl.id = ${position.levelId}
  `)) as unknown as {
    subject_name: string | null;
    subject_slug: string | null;
    level_name: string | null;
    stage: string | null;
  }[];

  if (!context?.subject_slug) return [];

  const rows = (await database.execute(sql`
    with visible as (
      select tc.tutor_id, tc.board_id, tc.level_id, tc.subject_id, cl.stage, cl.name as level_name,
             b.name as board_name
      from tutor_curriculum tc
      join tutor_profiles tp on tp.user_id = tc.tutor_id and tp.status = 'verified'
      join users u on u.id = tc.tutor_id and u.suspended_at is null
      join curriculum_levels cl on cl.board_id = tc.board_id and cl.id = tc.level_id
      join boards b on b.id = tc.board_id
      where tc.subject_id = ${position.subjectId}::uuid
    )
    select 'same_stage' as kind, board_id, level_id, board_name, level_name,
           count(distinct tutor_id)::int as tutors
    from visible
    where stage = ${context.stage} and board_id <> ${position.boardId}
    group by board_id, level_id, board_name, level_name

    union all

    select 'same_board' as kind, board_id, level_id, board_name, level_name,
           count(distinct tutor_id)::int as tutors
    from visible
    where board_id = ${position.boardId} and level_id <> ${position.levelId}
    group by board_id, level_id, board_name, level_name

    union all

    select 'any' as kind, null as board_id, null as level_id, null as board_name, null as level_name,
           count(distinct tutor_id)::int as tutors
    from visible

    order by 1, 6 desc
  `)) as unknown as {
    kind: string;
    board_id: string | null;
    level_id: string | null;
    board_name: string | null;
    level_name: string | null;
    tutors: number;
  }[];

  const options: NearestOption[] = [];

  for (const row of rows) {
    if (Number(row.tutors) === 0) continue;

    if (row.kind === 'same_stage' && row.board_id && row.level_id) {
      options.push({
        label: `${context.subject_name} at ${row.level_name} on ${row.board_name}`,
        filters: { board: row.board_id, level: row.level_id, subject: context.subject_slug },
        tutors: Number(row.tutors),
      });
    } else if (row.kind === 'same_board' && row.level_id) {
      options.push({
        label: `${context.subject_name} at ${row.level_name}, same board`,
        filters: { board: position.boardId, level: row.level_id, subject: context.subject_slug },
        tutors: Number(row.tutors),
      });
    } else if (row.kind === 'any') {
      options.push({
        label: `Every ${context.subject_name} tutor`,
        filters: { subject: context.subject_slug },
        tutors: Number(row.tutors),
      });
    }
  }

  // Three is a choice; six is another empty-handed decision to make.
  return options.slice(0, 3);
}

export type DemandRow = {
  board: string;
  level: string;
  subject: string;
  /** Distinct days somebody asked. Anonymous asks collapse to one a day. */
  asks: number;
  /** Of those, how many were signed in — the ones we could actually tell. */
  signedIn: number;
  lastAskedAt: Date;
};

/** What people asked for and did not find, for the admin dashboard. */
export async function askedAndMissing(
  limit = 12,
  database: DbLike = defaultDb,
): Promise<DemandRow[]> {
  const rows = (await database.execute(sql`
    select
      b.name as board,
      cl.name as level,
      s.name as subject,
      count(*)::int as asks,
      count(distinct ci.user_id)::int as signed_in,
      max(ci.created_at) as last_asked_at
    from curriculum_interest ci
    join boards b on b.id = ci.board_id
    join curriculum_levels cl on cl.board_id = ci.board_id and cl.id = ci.level_id
    join subjects s on s.id = ci.subject_id
    where ci.created_at > now() - interval '90 days'
      -- Still missing. Demand we have since answered is not a to-do list.
      and not exists (
        select 1 from tutor_curriculum tc
        join tutor_profiles tp on tp.user_id = tc.tutor_id and tp.status = 'verified'
        join users u on u.id = tc.tutor_id and u.suspended_at is null
        where tc.board_id = ci.board_id and tc.level_id = ci.level_id
          and tc.subject_id = ci.subject_id
      )
    group by b.name, cl.name, s.name
    order by asks desc, last_asked_at desc
    limit ${limit}
  `)) as unknown as {
    board: string;
    level: string;
    subject: string;
    asks: number;
    signed_in: number;
    last_asked_at: string;
  }[];

  return rows.map((row) => ({
    board: row.board,
    level: row.level,
    subject: row.subject,
    asks: Number(row.asks),
    signedIn: Number(row.signed_in),
    lastAskedAt: new Date(row.last_asked_at),
  }));
}

/**
 * How many tutors exist at all, ignoring every filter.
 *
 * The feed's shape is decided on this rather than on the current result count.
 * They are not the same question: a student whose declared curriculum matches
 * two tutors is looking at a narrow *result*, not a small *catalogue*, and
 * folding away the filters at that moment hides the controls they need to widen
 * the search — which is exactly what happened the first time this was wired to
 * `results.total`.
 */
export async function visibleTutorCount(database: DbLike = defaultDb): Promise<number> {
  const [row] = (await database.execute(sql`
    select count(*)::int as n
    from tutor_profiles tp
    join users u on u.id = tp.user_id
    where tp.status = 'verified' and u.suspended_at is null
  `)) as unknown as { n: number }[];

  return Number(row?.n ?? 0);
}

/**
 * Subjects with at least one bookable tutor behind them.
 *
 * The category chips are built from this rather than from every subject that
 * exists, because a chip that leads to an empty page is a dead end somebody
 * blames themselves for.
 */
export async function subjectsWithTutors(
  database: DbLike = defaultDb,
): Promise<{ slug: string; tutors: number }[]> {
  const rows = await database
    .select({
      slug: subjects.slug,
      tutors: sql<number>`count(distinct ${tutorCurriculum.tutorId})::int`,
    })
    .from(subjects)
    .innerJoin(tutorCurriculum, eq(tutorCurriculum.subjectId, subjects.id))
    .innerJoin(
      tutorProfiles,
      and(eq(tutorProfiles.userId, tutorCurriculum.tutorId), eq(tutorProfiles.status, 'verified')),
    )
    .innerJoin(users, eq(users.id, tutorCurriculum.tutorId))
    .where(sql`${users.suspendedAt} is null`)
    .groupBy(subjects.slug)
    .orderBy(desc(sql`count(distinct ${tutorCurriculum.tutorId})`));

  return rows.map((row) => ({ slug: row.slug, tutors: Number(row.tutors) }));
}
