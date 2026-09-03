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
 */

import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';

import { getAvailability } from '@/lib/availability';
import { BOOKABLE_TUTOR_STATUS } from '@/lib/tutors/status';
import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { subjects, tutorProfiles, tutorRanking, users, videos } from './schema';

export const SORT_OPTIONS = ['relevance', 'price_asc', 'price_desc', 'rating', 'sessions'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<SortOption, string> = {
  relevance: 'Relevance',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  rating: 'Rating',
  sessions: 'Most sessions',
};

export type DiscoveryFilters = {
  q?: string;
  /** Subject slug. */
  subject?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  /** Minimum displayed rating, in thousandths of a star. */
  minRatingMilli?: number;
  /** ISO 639-1 code. */
  language?: string;
  hasFreeTrial?: boolean;
  /** ISO 3166-1 alpha-2. */
  country?: string;
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
};

/** The one visibility rule: verified profile, unsuspended account. */
function visibleTutorCondition(): SQL {
  return and(eq(tutorProfiles.status, BOOKABLE_TUTOR_STATUS), isNull(users.suspendedAt))!;
}

const FEED_COLUMNS = {
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
  ratingMilli: tutorRanking.bayesianRatingMilli,
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

function baseQuery(database: DbLike) {
  return database
    .select(FEED_COLUMNS)
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

  return conditions;
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

function orderFor(sort: SortOption) {
  switch (sort) {
    case 'price_asc':
      return [asc(effectiveHourlyCents), byScore];
    case 'price_desc':
      return [desc(effectiveHourlyCents), byScore];
    case 'rating':
      return [sql`${tutorRanking.bayesianRatingMilli} desc nulls last`, byScore];
    case 'sessions':
      return [sql`${tutorRanking.sessionCount} desc nulls last`, byScore];
    case 'relevance':
    default:
      // Relevance is the nightly score. Nothing is computed per request.
      return [byScore, asc(users.name)];
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
  const conditions = buildConditions(filters);
  const where = and(...conditions)!;

  const rows = await baseQuery(database)
    .where(where)
    .orderBy(...orderFor(filters.sort ?? 'relevance'))
    // One extra row tells us whether there is another page, without a count.
    .limit(limit + 1)
    .offset(offset);

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

export async function railFreeTrials(database: DbLike = defaultDb): Promise<FeedTutor[]> {
  return baseQuery(database)
    .where(and(visibleTutorCondition(), eq(tutorProfiles.offersTrial, true))!)
    .orderBy(byScore)
    .limit(12) as unknown as Promise<FeedTutor[]>;
}

/**
 * "New tutors" — the exploration slot, so new supply is not starved. Membership
 * is exactly the tutors the nightly job is still giving an exploration boost.
 */
export async function railNewTutors(database: DbLike = defaultDb): Promise<FeedTutor[]> {
  return baseQuery(database)
    .where(and(visibleTutorCondition(), sql`coalesce(${tutorRanking.explorationBoost}, 0) > 0`)!)
    .orderBy(desc(tutorRanking.explorationBoost), byScore)
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
): Promise<FeedTutor[] | null> {
  const candidates = await baseQuery(database)
    .where(visibleTutorCondition())
    .orderBy(byScore)
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
