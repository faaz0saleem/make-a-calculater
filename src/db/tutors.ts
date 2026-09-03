/**
 * Tutor queries.
 *
 * Every query that decides who is visible goes through here, so the rule from
 * `src/lib/tutors/visibility.ts` is applied in one place rather than repeated
 * as an ad-hoc `where status = 'verified'` in each page.
 */

import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { BOOKABLE_TUTOR_STATUS, type TutorStatus } from '@/lib/tutors/status';
import type { WizardSnapshot } from '@/lib/tutors/wizard';
import { db as defaultDb } from './client';
import {
  availabilityRules,
  credentials,
  payoutMethods,
  tutorLanguages,
  tutorProfiles,
  tutorRanking,
  tutorSubjects,
  users,
  videos,
} from './schema';
import type { DbLike } from './ledger';

/** Aggregate counts as SQL so the wizard needs exactly one round trip. */
const countFor = (table: string, column: string, target: SQL) =>
  sql<number>`(select count(*)::int from ${sql.raw(table)} where ${sql.raw(column)} = ${target})`;

export async function loadWizardSnapshot(
  userId: string,
  database: DbLike = defaultDb,
): Promise<WizardSnapshot | null> {
  const [row] = await database
    .select({
      status: tutorProfiles.status,
      emailVerified: users.emailVerified,
      name: users.name,
      country: users.country,
      city: users.city,
      timezone: users.timezone,
      avatarUrl: users.image,
      headline: tutorProfiles.headline,
      bio: tutorProfiles.bio,
      hourlyCents: tutorProfiles.hourlyCents,
      halfHourCents: tutorProfiles.halfHourCents,
      videoStatus: videos.status,
      videoSeconds: videos.durationS,
      languageCount: countFor('tutor_languages', 'tutor_id', sql`${users.id}`),
      subjectCount: countFor('tutor_subjects', 'tutor_id', sql`${users.id}`),
      credentialCount: countFor('credentials', 'tutor_id', sql`${users.id}`),
      availabilityRuleCount: sql<number>`(
        select count(*)::int from availability_rules
        where tutor_id = ${users.id} and active
      )`,
      payoutMethodCount: countFor('payout_methods', 'tutor_id', sql`${users.id}`),
    })
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .leftJoin(videos, eq(videos.id, tutorProfiles.introVideoId))
    .where(eq(tutorProfiles.userId, userId))
    .limit(1);

  if (!row) return null;

  return {
    status: row.status as TutorStatus,
    emailVerified: row.emailVerified !== null,
    name: row.name,
    country: row.country,
    city: row.city,
    timezone: row.timezone,
    languageCount: Number(row.languageCount),
    headline: row.headline,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    introVideoStatus: row.videoStatus ?? 'missing',
    introVideoSeconds: row.videoSeconds,
    subjectCount: Number(row.subjectCount),
    credentialCount: Number(row.credentialCount),
    hourlyCents: row.hourlyCents,
    halfHourCents: row.halfHourCents,
    availabilityRuleCount: Number(row.availabilityRuleCount),
    payoutMethodCount: Number(row.payoutMethodCount),
  };
}

export type FeedTutor = {
  id: string;
  name: string;
  country: string | null;
  city: string | null;
  timezone: string;
  avatarUrl: string | null;
  headline: string | null;
  hourlyCents: number;
  halfHourCents: number;
  promoCents: number | null;
  offersTrial: boolean;
  ratingMilli: number | null;
  reviewCount: number | null;
  subjects: string[];
  thumbnailUrl: string | null;
};

/**
 * The feed and search (SPEC.md §4).
 *
 * The `where` clause is the visibility rule: verified profile, unsuspended
 * account. Nothing else in the codebase may widen it.
 */
export async function findVisibleTutors(
  options: { query?: string; limit?: number } = {},
  database: DbLike = defaultDb,
): Promise<FeedTutor[]> {
  const term = options.query?.trim() ?? '';

  const visible = and(
    eq(tutorProfiles.status, BOOKABLE_TUTOR_STATUS),
    isNull(users.suspendedAt),
  );

  // Full text over name, headline, bio and subject names (SPEC.md §4).
  const matchesSearch = term
    ? sql`(
        ${users.name} ilike ${'%' + term + '%'}
        or ${tutorProfiles.headline} ilike ${'%' + term + '%'}
        or ${tutorProfiles.bio} ilike ${'%' + term + '%'}
        or exists (
          select 1 from tutor_subjects ts
          join subjects s on s.id = ts.subject_id
          where ts.tutor_id = ${users.id} and s.name ilike ${'%' + term + '%'}
        )
      )`
    : undefined;

  return database
    .select({
      id: users.id,
      name: users.name,
      country: users.country,
      city: users.city,
      timezone: users.timezone,
      avatarUrl: users.image,
      headline: tutorProfiles.headline,
      hourlyCents: tutorProfiles.hourlyCents,
      halfHourCents: tutorProfiles.halfHourCents,
      promoCents: tutorProfiles.promoCents,
      offersTrial: tutorProfiles.offersTrial,
      ratingMilli: tutorRanking.bayesianRatingMilli,
      reviewCount: tutorRanking.reviewCount,
      thumbnailUrl: videos.thumbnailUrl,
      subjects: sql<string[]>`coalesce((
        select array_agg(s.name order by s.name)
        from tutor_subjects ts join subjects s on s.id = ts.subject_id
        where ts.tutor_id = ${users.id}
      ), '{}')`,
    })
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .leftJoin(tutorRanking, eq(tutorRanking.tutorId, tutorProfiles.userId))
    .leftJoin(videos, eq(videos.id, tutorProfiles.introVideoId))
    .where(matchesSearch ? and(visible, matchesSearch) : visible)
    .orderBy(desc(tutorRanking.score))
    .limit(options.limit ?? 40);
}

export type TutorDossier = {
  id: string;
  name: string;
  email: string;
  country: string | null;
  city: string | null;
  timezone: string;
  avatarUrl: string | null;
  userSuspendedAt: Date | null;
  status: TutorStatus;
  headline: string | null;
  bio: string | null;
  hourlyCents: number;
  halfHourCents: number;
  promoCents: number | null;
  promoStartsAt: Date | null;
  promoEndsAt: Date | null;
  commissionBps: number;
  offersTrial: boolean;
  trialMinutes: number;
  submittedAt: Date | null;
  verifiedAt: Date | null;
  rejectionReason: string | null;
  strikes: number;
  video: {
    id: string;
    status: string;
    durationS: number | null;
    previewUrl: string | null;
    heroUrl: string | null;
    thumbnailUrl: string | null;
  } | null;
  subjects: { name: string; level: string; yearsExperience: number }[];
  languages: { languageCode: string; proficiency: string }[];
  credentials: {
    id: string;
    kind: string;
    title: string;
    institution: string;
    year: number | null;
    fileKey: string;
    status: string;
    note: string | null;
  }[];
  availability: { weekdayLocal: number; startTimeLocal: string; endTimeLocal: string; timezone: string }[];
};

/**
 * Everything about one tutor: the claims they made and the documents backing
 * them. Used by the public profile page, the tutor's own preview, and the admin
 * verification screen.
 *
 * The caller decides who is allowed to see it — `canViewProfile` in
 * `src/lib/tutors/visibility.ts`.
 */
export async function loadTutorDossier(
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<TutorDossier | null> {
  const [row] = await database
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      country: users.country,
      city: users.city,
      timezone: users.timezone,
      avatarUrl: users.image,
      userSuspendedAt: users.suspendedAt,
      status: tutorProfiles.status,
      headline: tutorProfiles.headline,
      bio: tutorProfiles.bio,
      hourlyCents: tutorProfiles.hourlyCents,
      halfHourCents: tutorProfiles.halfHourCents,
      promoCents: tutorProfiles.promoCents,
      promoStartsAt: tutorProfiles.promoStartsAt,
      promoEndsAt: tutorProfiles.promoEndsAt,
      commissionBps: tutorProfiles.commissionBps,
      offersTrial: tutorProfiles.offersTrial,
      trialMinutes: tutorProfiles.trialMinutes,
      submittedAt: tutorProfiles.submittedAt,
      verifiedAt: tutorProfiles.verifiedAt,
      rejectionReason: tutorProfiles.rejectionReason,
      strikes: tutorProfiles.strikes,
      videoId: videos.id,
      videoStatus: videos.status,
      videoSeconds: videos.durationS,
      videoPreview: videos.previewUrl,
      videoHero: videos.heroUrl,
      videoThumbnail: videos.thumbnailUrl,
    })
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .leftJoin(videos, eq(videos.id, tutorProfiles.introVideoId))
    .where(eq(tutorProfiles.userId, tutorId))
    .limit(1);

  if (!row) return null;

  const [subjectRows, languageRows, credentialRows, availabilityRows] = await Promise.all([
    database
      .select({
        name: sql<string>`s.name`,
        level: tutorSubjects.level,
        yearsExperience: tutorSubjects.yearsExperience,
      })
      .from(tutorSubjects)
      .innerJoin(sql`subjects s`, sql`s.id = ${tutorSubjects.subjectId}`)
      .where(eq(tutorSubjects.tutorId, tutorId)),
    database
      .select({ languageCode: tutorLanguages.languageCode, proficiency: tutorLanguages.proficiency })
      .from(tutorLanguages)
      .where(eq(tutorLanguages.tutorId, tutorId)),
    database
      .select({
        id: credentials.id,
        kind: credentials.kind,
        title: credentials.title,
        institution: credentials.institution,
        year: credentials.year,
        fileKey: credentials.fileKey,
        status: credentials.status,
        note: credentials.note,
      })
      .from(credentials)
      .where(eq(credentials.tutorId, tutorId))
      .orderBy(asc(credentials.createdAt)),
    database
      .select({
        weekdayLocal: availabilityRules.weekdayLocal,
        startTimeLocal: availabilityRules.startTimeLocal,
        endTimeLocal: availabilityRules.endTimeLocal,
        timezone: availabilityRules.timezone,
      })
      .from(availabilityRules)
      .where(and(eq(availabilityRules.tutorId, tutorId), eq(availabilityRules.active, true)))
      .orderBy(asc(availabilityRules.weekdayLocal), asc(availabilityRules.startTimeLocal)),
  ]);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    country: row.country,
    city: row.city,
    timezone: row.timezone,
    avatarUrl: row.avatarUrl,
    userSuspendedAt: row.userSuspendedAt,
    status: row.status as TutorStatus,
    headline: row.headline,
    bio: row.bio,
    hourlyCents: row.hourlyCents,
    halfHourCents: row.halfHourCents,
    promoCents: row.promoCents,
    promoStartsAt: row.promoStartsAt,
    promoEndsAt: row.promoEndsAt,
    commissionBps: row.commissionBps,
    offersTrial: row.offersTrial,
    trialMinutes: row.trialMinutes,
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    rejectionReason: row.rejectionReason,
    strikes: row.strikes,
    video: row.videoId
      ? {
          id: row.videoId,
          status: row.videoStatus ?? 'missing',
          durationS: row.videoSeconds,
          previewUrl: row.videoPreview,
          heroUrl: row.videoHero,
          thumbnailUrl: row.videoThumbnail,
        }
      : null,
    subjects: subjectRows,
    languages: languageRows,
    credentials: credentialRows,
    availability: availabilityRows,
  };
}

/** The admin verification queue, oldest submission first. */
export async function loadVerificationQueue(database: DbLike = defaultDb) {
  return database
    .select({
      id: tutorProfiles.userId,
      name: users.name,
      email: users.email,
      country: users.country,
      submittedAt: tutorProfiles.submittedAt,
      hourlyCents: tutorProfiles.hourlyCents,
      credentialCount: countFor('credentials', 'tutor_id', sql`${users.id}`),
    })
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .where(eq(tutorProfiles.status, 'pending_review'))
    .orderBy(asc(tutorProfiles.submittedAt));
}
