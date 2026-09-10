/**
 * Discovery: the feed, search, filters and the home rails (SPEC.md §4).
 *
 * Two rules hold this file together:
 *
 *  1. Visibility is decided in one place. Every query starts from
 *     `visibleTutorCondition`, which is the SQL form of the rule in
 *     `src/lib/tutors/visibility.ts`.
 *  2. Ranking is never computed here. The nightly job writes `tutor_ranking`
 *     and these queries order by its `score` column (SPEC.md §4).
 *
 * Curriculum matching (SPEC.md §4) sits on top of both. The match tier leads
 * the ordering, so an exact board-class-subject match outweighs a rating — a
 * key, not another weighted term, because a weight can always be out-argued by
 * a big enough rating gap. `src/lib/curriculum/ordering.ts` is the readable
 * statement of the same rule, and the tests check it there.
 *
 * The timezone-overlap term is the one thing here that touches a viewer: it is
 * a bitwise AND against `tutor_ranking.free_hours_mask`, which the nightly job
 * computes. Counting the bits two integers share is not computing a ranking.
 */

import { and, asc, desc, eq, gte, isNull, sql, type SQL } from 'drizzle-orm';

import { getAvailability } from '@/lib/availability';
import { MATCH_TIERS, type CurriculumPosition, type MatchTier } from '@/lib/curriculum/match';
import { TOPIC_MAX_BPS } from '@/lib/curriculum/ordering';
import {
  OVERLAP_MAX_BPS,
  OVERLAP_TARGET_HOURS,
  OVERLAP_UNKNOWN_BPS,
  studyWindowMaskUtc,
} from '@/lib/ranking/overlap';
import { BOOKABLE_TUTOR_STATUS } from '@/lib/tutors/status';
import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { subjects, tutorProfiles, tutorRanking, users, videos } from './schema';

/**
 * How many ranked tutors the day-and-time filter will consult the calendar
 * about. Well beyond a page, and bounded so the filter cannot turn into a scan.
 */
const TIME_FILTER_CANDIDATE_LIMIT = 200;

export const SORT_OPTIONS = ['relevance', 'price_asc', 'price_desc', 'rating', 'sessions'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<SortOption, string> = {
  relevance: 'Relevance',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  rating: 'Rating',
  sessions: 'Most sessions',
};

/**
 * A curriculum filter from the filter bar.
 *
 * Any subset of the three fields; each one that is present excludes. When the
 * whole triple is present, `includeNearMatches` decides whether a tutor who
 * teaches the same subject at the same stage under a different board is still
 * admitted — labelled as a near match and ranked below every exact one.
 */
export type CurriculumFilter = {
  boardId?: string;
  levelId?: string;
  subjectId?: string;
  /** The level's board-independent stage, needed to admit near matches. */
  stage?: string;
  includeNearMatches?: boolean;
};

/**
 * Who is looking.
 *
 * Their declared positions decide the match tier, and their timezone decides
 * the overlap bonus. Both are read from the session on the server — never from
 * a query string — so nobody can rank themselves up by editing a URL.
 */
export type ViewerContext = {
  timezone?: string | null;
  positions?: readonly CurriculumPosition[];
};

export type DiscoveryFilters = {
  q?: string;
  /** Subject slug. */
  subject?: string;
  curriculum?: CurriculumFilter;
  viewer?: ViewerContext;
  minPriceCents?: number;
  maxPriceCents?: number;
  /** Minimum displayed rating, in thousandths of a star. */
  minRatingMilli?: number;
  /** ISO 639-1 code. */
  language?: string;
  hasFreeTrial?: boolean;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  /**
   * Day-and-time window (SPEC.md §4). Resolved through the availability port
   * rather than in SQL, because "free" means rules minus exceptions minus
   * bookings minus buffers — none of which is a column.
   */
  availableFromUtc?: Date;
  availableToUtc?: Date;
  availableDurationMinutes?: number;
  /**
   * Chapters the student is asking about (SPEC.md §4).
   *
   * A tiebreak inside the exact-match tier and nothing else — a tutor who has
   * declared these chapters edges out one who has not, and no number of ticked
   * boxes lifts anybody out of a lower tier. See `lib/curriculum/ordering.ts`
   * for why the ceiling is deliberately below a three-tenths-of-a-star gap.
   */
  topicIds?: readonly string[];
  sort?: SortOption;
  limit?: number;
  offset?: number;
};

export type FeedTutor = {
  id: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  country: string | null;
  city: string | null;
  timezone: string;
  hourlyCents: number;
  halfHourCents: number;
  promoCents: number | null;
  offersTrial: boolean;
  trialMinutes: number;
  ratingMilli: number | null;
  reviewCount: number;
  sessionCount: number;
  responseMedianSeconds: number | null;
  verifiedAt: Date | null;
  subjectNames: string[];
  posterUrl: string | null;
  previewUrl: string | null;
  /**
   * 0-3 against the viewer's declared curriculum. Zero when they have declared
   * none, which is also what an anonymous visitor sees.
   */
  matchTier: MatchTier;
};

/** The one visibility rule: verified profile, unsuspended account. */
function visibleTutorCondition(): SQL {
  return and(eq(tutorProfiles.status, BOOKABLE_TUTOR_STATUS), isNull(users.suspendedAt))!;
}

/**
 * The match tier, as SQL.
 *
 * One correlated lookup per candidate row against `tutor_curriculum`. The
 * primary key starts with `tutor_id`, so each lookup is a prefix scan over at
 * most fifteen rows — cheap, but paid once per visible tutor when the student
 * clears the filter and asks to see everyone.
 *
 * That is affordable at this size and would not be at a hundred thousand
 * tutors. The step when it stops being affordable is to denormalise each
 * tutor's positions onto `tutor_ranking` as an array with a GIN index, written
 * by the same nightly job that writes the score — not to move any of this into
 * the request path.
 */
function matchTierSql(positions: readonly CurriculumPosition[]): SQL {
  const rows = sql.join(
    positions.map(
      (position) =>
        sql`(${position.boardId}::text, ${position.levelId}::text, ${position.stage}::curriculum_stage, ${position.subjectId}::uuid)`,
    ),
    sql`, `,
  );

  return sql`coalesce((
    select max(case
      when tc.board_id = p.board_id and tc.level_id = p.level_id then ${MATCH_TIERS.exact}
      when tc.board_id = p.board_id then ${MATCH_TIERS.board}
      when cl.stage = p.stage and tc.board_id <> 'other' and p.board_id <> 'other'
        then ${MATCH_TIERS.stage}
      else ${MATCH_TIERS.none}
    end)
    from tutor_curriculum tc
    join curriculum_levels cl on cl.id = tc.level_id
    join (values ${rows}) as p(board_id, level_id, stage, subject_id)
      on p.subject_id = tc.subject_id
    where tc.tutor_id = ${users.id}
  ), ${MATCH_TIERS.none})`;
}

/**
 * The timezone-overlap bonus, as SQL.
 *
 * `src/lib/ranking/overlap.ts` is the definition; this is the same arithmetic
 * where the rows are. An empty mask means the tutor has published no hours, and
 * scores the neutral midpoint rather than zero — the same "unknown is not no"
 * rule the availability port keeps.
 */
function overlapBonusSql(viewerMask: number): SQL {
  const mask = sql`coalesce(${tutorRanking.freeHoursMask}, 0)`;
  return sql`(case
    when ${mask} = 0 then ${OVERLAP_UNKNOWN_BPS}
    else round(
      least(bit_count((${mask} & ${viewerMask})::bit(32)), ${OVERLAP_TARGET_HOURS})::numeric
        * ${OVERLAP_MAX_BPS} / ${OVERLAP_TARGET_HOURS}
    )
  end)`;
}

/**
 * The viewer's own study-hours mask, or null when we do not know where they are.
 *
 * Null means the term is skipped entirely, not defaulted to UTC. Assuming UTC
 * would quietly promote tutors whose evenings happen to fall in Europe for a
 * visitor in Karachi whose timezone we simply have not learned yet — a guess
 * dressed as a fact, which is the one thing the availability port has never
 * been allowed to do either.
 */
function viewerMaskFor(viewer: ViewerContext | undefined, now = new Date()): number | null {
  const timezone = viewer?.timezone;
  return timezone ? studyWindowMaskUtc(timezone, now) : null;
}

function viewerPositions(viewer: ViewerContext | undefined): readonly CurriculumPosition[] {
  return viewer?.positions ?? [];
}

const BASE_FEED_COLUMNS = {
  id: users.id,
  name: users.name,
  headline: tutorProfiles.headline,
  avatarUrl: users.image,
  country: users.country,
  city: users.city,
  timezone: users.timezone,
  hourlyCents: tutorProfiles.hourlyCents,
  halfHourCents: tutorProfiles.halfHourCents,
  promoCents: tutorProfiles.promoCents,
  offersTrial: tutorProfiles.offersTrial,
  trialMinutes: tutorProfiles.trialMinutes,
  responseMedianSeconds: tutorProfiles.responseMedianSeconds,
  verifiedAt: tutorProfiles.verifiedAt,
  /**
   * Null until somebody has actually rated them.
   *
   * `bayesian_rating_milli` defaults to the prior — 4300 — and that is right
   * for *ranking*: it stops one five-star review outranking two hundred. It is
   * wrong to *show*, because a tutor nobody has reviewed is not rated 4.3, and
   * on day one that is every tutor on the page. Three cards all claiming
   * "4.3 (0)" is an invented number, and the card already knows how to say
   * "No reviews yet" — it just never got the chance.
   */
  ratingMilli: sql<number | null>`case when coalesce(${tutorRanking.reviewCount}, 0) > 0
    then ${tutorRanking.bayesianRatingMilli} end`,
  reviewCount: sql<number>`coalesce(${tutorRanking.reviewCount}, 0)`,
  sessionCount: sql<number>`coalesce(${tutorRanking.sessionCount}, 0)`,
  posterUrl: videos.thumbnailUrl,
  previewUrl: videos.previewUrl,
  subjectNames: sql<string[]>`coalesce((
    select array_agg(s.name order by s.name)
    from tutor_subjects ts join subjects s on s.id = ts.subject_id
    where ts.tutor_id = ${users.id}
  ), '{}')`,
} as const;

/**
 * The output alias the ordering names.
 *
 * Aliased rather than repeated so the correlated subquery runs once per row
 * instead of twice — Postgres will not collapse two identical subqueries for
 * you, and this one is in both the select list and the ORDER BY.
 */
const MATCH_TIER_ALIAS = 'match_tier';

function feedColumns(positions: readonly CurriculumPosition[]) {
  return {
    ...BASE_FEED_COLUMNS,
    matchTier: (positions.length > 0 ? matchTierSql(positions) : sql`${MATCH_TIERS.none}`)
      .mapWith(Number)
      .as(MATCH_TIER_ALIAS) as unknown as SQL<MatchTier>,
  };
}

function baseQuery(database: DbLike, positions: readonly CurriculumPosition[] = []) {
  return database
    .select(feedColumns(positions))
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .leftJoin(tutorRanking, eq(tutorRanking.tutorId, tutorProfiles.userId))
    .leftJoin(videos, eq(videos.id, tutorProfiles.introVideoId));
}

/** Full text over name, headline, bio and subject names (SPEC.md §4). */
function textMatch(term: string): SQL {
  const pattern = `%${term}%`;
  return sql`(
    ${users.name} ilike ${pattern}
    or ${tutorProfiles.headline} ilike ${pattern}
    or ${tutorProfiles.bio} ilike ${pattern}
    or exists (
      select 1 from tutor_subjects ts join subjects s on s.id = ts.subject_id
      where ts.tutor_id = ${users.id} and s.name ilike ${pattern}
    )
  )`;
}

/**
 * The 60-minute price a student would actually pay right now.
 *
 * Filtering and sorting both use this, so a tutor running a promo appears in
 * the cheaper band *and* in the right place when the results are sorted by
 * price. Using the list price for one and the promo price for the other put
 * $6.40 after $8.00.
 */
const effectiveHourlyCents = sql`coalesce(
  case
    when ${tutorProfiles.promoCents} is not null
      and ${tutorProfiles.promoCents} < ${tutorProfiles.hourlyCents}
      and (${tutorProfiles.promoStartsAt} is null or ${tutorProfiles.promoStartsAt} <= now())
      and (${tutorProfiles.promoEndsAt} is null or ${tutorProfiles.promoEndsAt} > now())
    then ${tutorProfiles.promoCents}
  end,
  ${tutorProfiles.hourlyCents}
)`;

function buildConditions(filters: DiscoveryFilters): SQL[] {
  const conditions: SQL[] = [visibleTutorCondition()];

  const term = filters.q?.trim();
  if (term) conditions.push(textMatch(term));

  if (filters.subject) {
    conditions.push(sql`exists (
      select 1 from tutor_subjects ts join subjects s on s.id = ts.subject_id
      where ts.tutor_id = ${users.id} and s.slug = ${filters.subject}
    )`);
  }

  if (filters.language) {
    conditions.push(sql`exists (
      select 1 from tutor_languages tl
      where tl.tutor_id = ${users.id} and tl.language_code = ${filters.language}
    )`);
  }

  if (typeof filters.minPriceCents === 'number') {
    conditions.push(sql`${effectiveHourlyCents} >= ${filters.minPriceCents}`);
  }
  if (typeof filters.maxPriceCents === 'number') {
    conditions.push(sql`${effectiveHourlyCents} <= ${filters.maxPriceCents}`);
  }

  if (typeof filters.minRatingMilli === 'number') {
    conditions.push(gte(tutorRanking.bayesianRatingMilli, filters.minRatingMilli));
  }
  if (filters.hasFreeTrial) {
    conditions.push(eq(tutorProfiles.offersTrial, true));
  }
  if (filters.country) {
    conditions.push(eq(users.country, filters.country.toUpperCase()));
  }

  const curriculum = curriculumCondition(filters.curriculum);
  if (curriculum) conditions.push(curriculum);

  return conditions;
}

/**
 * The curriculum filter.
 *
 * Every field present narrows. With the whole triple and `includeNearMatches`,
 * a tutor also qualifies by teaching the same subject at the same stage under
 * another board — which is what stops a student with a niche position landing
 * on an empty page. The catch-all `other` board never near-matches: two people
 * who both picked "not listed" have told us nothing they have in common.
 */
function curriculumCondition(filter: CurriculumFilter | undefined): SQL | null {
  if (!filter) return null;

  const { boardId, levelId, subjectId, stage, includeNearMatches } = filter;
  if (!boardId && !levelId && !subjectId) return null;

  const clauses: SQL[] = [];
  const near = Boolean(includeNearMatches && boardId && stage && boardId !== 'other');

  if (subjectId) clauses.push(sql`tc.subject_id = ${subjectId}::uuid`);

  if (boardId && levelId && near) {
    // Same board at any level, or the same stage on a board that is not the
    // catch-all. The exact level is not required here; the tier orders it.
    clauses.push(sql`(
      tc.board_id = ${boardId}
      or (cl.stage = ${stage}::curriculum_stage and tc.board_id <> 'other')
    )`);
  } else {
    if (boardId) clauses.push(sql`tc.board_id = ${boardId}`);
    if (levelId) clauses.push(sql`tc.level_id = ${levelId}`);
  }

  return sql`exists (
    select 1
    from tutor_curriculum tc
    join curriculum_levels cl on cl.id = tc.level_id
    where tc.tutor_id = ${users.id}
      and ${sql.join(clauses, sql` and `)}
  )`;
}

/**
 * Ranked ordering, unranked last.
 *
 * Postgres puts NULLs first in a DESC sort, so a tutor verified since the last
 * nightly run — who has no `tutor_ranking` row yet — would silently top the
 * entire feed. `nulls last` puts them at the back instead, and
 * `recomputeTutorRankingFor` scores them at the moment they are approved so
 * they do not sit there.
 */
const byScore = sql`${tutorRanking.score} desc nulls last`;

/** The nightly score plus the viewer's timezone-overlap bonus, if we have one. */
function byAdjustedScore(viewerMask: number | null): SQL {
  if (viewerMask === null) return byScore;
  return sql`(${tutorRanking.score} + ${overlapBonusSql(viewerMask)}) desc nulls last`;
}

/** The same expression without the `desc`, so a bonus can be added to it. */
function byAdjustedScoreExpression(viewerMask: number | null): SQL {
  return viewerMask === null
    ? sql`coalesce(${tutorRanking.score}, -1)`
    : sql`coalesce(${tutorRanking.score} + ${overlapBonusSql(viewerMask)}, -1)`;
}

/**
 * The match tier leads every sort, not only relevance.
 *
 * A student who has said they sit CAIE AS Maths and then sorts by price wants
 * the cheapest tutor *who teaches that*, not the cheapest tutor on the site.
 * The chosen sort orders within each tier.
 *
 * Named by its select alias rather than repeated, so the correlated subquery
 * runs once per row instead of twice.
 */
const byMatchTier = sql`${sql.identifier(MATCH_TIER_ALIAS)} desc`;

/**
 * The chapter tiebreak, as SQL.
 *
 * Applied only where the match tier is already `exact`, so it can order tutors
 * who all teach the student's syllabus and can never promote one who does not.
 * The ceiling matches `TOPIC_MAX_BPS` in `lib/curriculum/ordering.ts`, which is
 * the readable statement of this same rule.
 */
function topicBonusSql(topicIds: readonly string[]): SQL {
  const ids = sql.join(
    topicIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  return sql`(case when ${sql.identifier(MATCH_TIER_ALIAS)} = ${MATCH_TIERS.exact} then
    (select round((count(*)::numeric * ${TOPIC_MAX_BPS}) / ${topicIds.length})
     from tutor_topics tt
     where tt.tutor_id = ${users.id} and tt.topic_id in (${ids}))
    else 0 end)`;
}

function orderFor(
  sort: SortOption,
  options: { viewerMask: number | null; matched: boolean; topicIds?: readonly string[] },
) {
  const bonus =
    options.matched && options.topicIds && options.topicIds.length > 0
      ? topicBonusSql(options.topicIds)
      : null;

  const adjusted = bonus
    ? sql`(${byAdjustedScoreExpression(options.viewerMask)} + coalesce(${bonus}, 0)) desc nulls last`
    : byAdjustedScore(options.viewerMask);

  const lead: SQL[] = options.matched ? [byMatchTier] : [];

  switch (sort) {
    case 'price_asc':
      return [...lead, asc(effectiveHourlyCents), adjusted];
    case 'price_desc':
      return [...lead, desc(effectiveHourlyCents), adjusted];
    case 'rating':
      return [...lead, sql`${tutorRanking.bayesianRatingMilli} desc nulls last`, adjusted];
    case 'sessions':
      return [...lead, sql`${tutorRanking.sessionCount} desc nulls last`, adjusted];
    case 'relevance':
    default:
      // Relevance is the nightly score, adjusted only by a bit count. Nothing
      // is recomputed per request.
      return [...lead, adjusted, asc(users.name)];
  }
}

export type SearchResult = {
  tutors: FeedTutor[];
  total: number;
  hasMore: boolean;
};

export async function searchTutors(
  filters: DiscoveryFilters = {},
  database: DbLike = defaultDb,
): Promise<SearchResult> {
  const limit = Math.min(filters.limit ?? 24, 60);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where = and(...buildConditions(filters))!;

  const positions = viewerPositions(filters.viewer);
  const viewerMask = viewerMaskFor(filters.viewer);
  const wantsTimeWindow = Boolean(filters.availableFromUtc && filters.availableToUtc);

  // Without a time filter, page in SQL. With one, the filter is not expressible
  // as a column, so take a bounded candidate set, ask the calendar, then page
  // the survivors. The bound is what stops this becoming a table scan.
  const rows = await baseQuery(database, positions)
    .where(where)
    .orderBy(
      ...orderFor(filters.sort ?? 'relevance', {
        viewerMask,
        matched: positions.length > 0,
        topicIds: filters.topicIds,
      }),
    )
    .limit(wantsTimeWindow ? TIME_FILTER_CANDIDATE_LIMIT : limit + 1)
    .offset(wantsTimeWindow ? 0 : offset);

  if (!wantsTimeWindow) {
    const [{ total }] = (await database.execute(sql`
      select count(*)::int as total
      from tutor_profiles
      join users on users.id = tutor_profiles.user_id
      left join tutor_ranking on tutor_ranking.tutor_id = tutor_profiles.user_id
      where ${where}
    `)) as unknown as [{ total: number }];

    const hasMore = rows.length > limit;
    return { tutors: (hasMore ? rows.slice(0, limit) : rows) as FeedTutor[], total: Number(total), hasMore };
  }

  const candidates = rows as unknown as FeedTutor[];
  const free = await getAvailability().tutorsFreeBetween(
    candidates.map((tutor) => tutor.id),
    filters.availableFromUtc!,
    filters.availableToUtc!,
    filters.availableDurationMinutes ?? 30,
  );

  // A calendar that cannot answer must not silently empty the results.
  const matching = free.known
    ? candidates.filter((tutor) => new Set(free.value).has(tutor.id))
    : candidates;

  return {
    tutors: matching.slice(offset, offset + limit),
    total: matching.length,
    hasMore: matching.length > offset + limit,
  };
}

// ---------------------------------------------------------------------------
// Home rails (SPEC.md §4)
// ---------------------------------------------------------------------------

/**
 * "Continue with your tutors" — built from real session history, not from a
 * browsing trail. A tutor appears here because the student has actually had a
 * paid session with them.
 */
export async function railContinueWithYourTutors(
  studentId: string,
  database: DbLike = defaultDb,
): Promise<FeedTutor[]> {
  return baseQuery(database)
    .where(
      and(
        visibleTutorCondition(),
        sql`exists (
          select 1 from bookings b
          where b.tutor_id = ${users.id}
            and b.student_id = ${studentId}
            and not b.is_trial
            and b.status = 'settled'
        )`,
      )!,
    )
    .orderBy(
      desc(sql`(
        select max(b.start_at_utc) from bookings b
        where b.tutor_id = ${users.id} and b.student_id = ${studentId} and b.status = 'settled'
      )`),
    )
    .limit(12) as unknown as Promise<FeedTutor[]>;
}

export async function railFreeTrials(
  database: DbLike = defaultDb,
  viewer?: ViewerContext,
): Promise<FeedTutor[]> {
  return baseQuery(database, viewerPositions(viewer))
    .where(and(visibleTutorCondition(), eq(tutorProfiles.offersTrial, true))!)
    .orderBy(...railOrder(viewer))
    .limit(12) as unknown as Promise<FeedTutor[]>;
}

/**
 * How every rail orders: match tier, then the score with the overlap bonus.
 *
 * The rails are the first thing a signed-in student sees, so they honour the
 * same rule the feed does rather than showing a differently-ordered world.
 */
function railOrder(viewer: ViewerContext | undefined): SQL[] {
  const positions = viewerPositions(viewer);
  const adjusted = byAdjustedScore(viewerMaskFor(viewer));
  return positions.length > 0 ? [byMatchTier, adjusted] : [adjusted];
}

/**
 * "New tutors" — the exploration slot, so new supply is not starved. Membership
 * is exactly the tutors the nightly job is still giving an exploration boost.
 */
export async function railNewTutors(
  database: DbLike = defaultDb,
  viewer?: ViewerContext,
): Promise<FeedTutor[]> {
  return baseQuery(database, viewerPositions(viewer))
    .where(and(visibleTutorCondition(), sql`coalesce(${tutorRanking.explorationBoost}, 0) > 0`)!)
    // The exploration boost is the point of this rail, so it leads here.
    .orderBy(desc(tutorRanking.explorationBoost), byScore)
    .limit(12) as unknown as Promise<FeedTutor[]>;
}

/**
 * "Tutors for your class" — the rail the curriculum triple earns.
 *
 * Empty for a student who has not told us where they are, which is exactly
 * right: there is nothing honest to put in it until they do.
 */
export async function railForYourCurriculum(
  viewer: ViewerContext,
  database: DbLike = defaultDb,
): Promise<FeedTutor[]> {
  const positions = viewerPositions(viewer);
  if (positions.length === 0) return [];

  const primary = positions[0]!;

  return baseQuery(database, positions)
    .where(
      and(
        visibleTutorCondition(),
        curriculumCondition({
          boardId: primary.boardId,
          levelId: primary.levelId,
          subjectId: primary.subjectId,
          stage: primary.stage,
          includeNearMatches: true,
        })!,
      )!,
    )
    .orderBy(...railOrder(viewer))
    .limit(12) as unknown as Promise<FeedTutor[]>;
}

export async function railTopRatedInSubject(
  subjectSlug: string,
  database: DbLike = defaultDb,
): Promise<FeedTutor[]> {
  return baseQuery(database)
    .where(
      and(
        visibleTutorCondition(),
        sql`exists (
          select 1 from tutor_subjects ts join subjects s on s.id = ts.subject_id
          where ts.tutor_id = ${users.id} and s.slug = ${subjectSlug}
        )`,
      )!,
    )
    .orderBy(sql`${tutorRanking.bayesianRatingMilli} desc nulls last`, byScore)
    .limit(12) as unknown as Promise<FeedTutor[]>;
}

/**
 * "Available in the next hour".
 *
 * Asks the availability port, which does not know until Phase 3. When it does
 * not know, this returns null and the rail renders an honest placeholder rather
 * than a list of tutors who might not be free at all.
 */
export async function railAvailableSoon(
  minutes = 60,
  database: DbLike = defaultDb,
  viewer?: ViewerContext,
): Promise<FeedTutor[] | null> {
  const candidates = await baseQuery(database, viewerPositions(viewer))
    .where(visibleTutorCondition())
    .orderBy(...railOrder(viewer))
    .limit(60);

  const free = await getAvailability().tutorsFreeWithin(
    minutes,
    candidates.map((tutor) => tutor.id),
  );
  if (!free.known) return null;

  const allowed = new Set(free.value);
  return (candidates as unknown as FeedTutor[]).filter((tutor) => allowed.has(tutor.id)).slice(0, 12);
}

export async function listSubjects(database: DbLike = defaultDb) {
  return database
    .select({ id: subjects.id, slug: subjects.slug, name: subjects.name })
    .from(subjects)
    .orderBy(asc(subjects.sortOrder), asc(subjects.name));
}

/** Countries that actually have a visible tutor, for the filter dropdown. */
export async function listTutorCountries(database: DbLike = defaultDb): Promise<string[]> {
  const rows = (await database.execute(sql`
    select distinct users.country
    from tutor_profiles
    join users on users.id = tutor_profiles.user_id
    where tutor_profiles.status = 'verified'
      and users.suspended_at is null
      and users.country is not null
    order by users.country
  `)) as unknown as { country: string }[];

  return rows.map((row) => row.country);
}
