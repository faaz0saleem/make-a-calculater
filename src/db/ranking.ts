/**
 * The nightly ranking job (SPEC.md §4).
 *
 * Gathers every input in one query, scores them with the pure function in
 * `src/lib/ranking/score.ts`, and writes `tutor_ranking`. The feed then orders
 * by a single indexed column.
 *
 * "Do not compute in the request path" is the rule this file exists to keep.
 * Nothing in `src/app` may import from here except the cron route.
 */

import { sql } from 'drizzle-orm';

import { getAvailability } from '@/lib/availability';
import { computeRanking, type RankingInputs } from '@/lib/ranking/score';
import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { tutorRanking } from './schema';

type InputRow = {
  tutor_id: string;
  rating_sum: string | number;
  review_count: string | number;
  settled_count: string | number;
  terminal_count: string | number;
  trial_count: string | number;
  trial_converted_count: string | number;
  response_median_seconds: number | null;
  last_active_at: string | Date | null;
  verified_at: string | Date | null;
};

export type RankingRun = {
  computedAt: Date;
  tutorCount: number;
  availabilitySource: string;
  availabilityKnown: boolean;
  topScore: number;
  medianScore: number;
};

function toDate(value: string | Date | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Score every verified tutor and replace `tutor_ranking`.
 *
 * Only verified tutors are scored: nobody else can appear in the feed, so
 * ranking them would be work with no reader.
 */
export async function recomputeTutorRanking(
  database: DbLike = defaultDb,
  now = new Date(),
  onlyTutorIds?: string[],
): Promise<RankingRun> {
  const rows = (await database.execute(sql`
    select
      t.user_id::text as tutor_id,
      coalesce(r.rating_sum, 0) as rating_sum,
      coalesce(r.review_count, 0) as review_count,
      coalesce(b.settled_count, 0) as settled_count,
      coalesce(b.terminal_count, 0) as terminal_count,
      coalesce(tr.trial_count, 0) as trial_count,
      coalesce(cv.trial_converted_count, 0) as trial_converted_count,
      t.response_median_seconds,
      greatest(t.updated_at, b.last_session_at) as last_active_at,
      t.verified_at
    from tutor_profiles t
    left join (
      select tutor_id, sum(rating) as rating_sum, count(*) as review_count
      from reviews where hidden_at is null
      group by tutor_id
    ) r on r.tutor_id = t.user_id
    left join (
      select
        tutor_id,
        count(*) filter (where status = 'settled' and not is_trial) as settled_count,
        count(*) filter (
          where not is_trial
            and status in ('settled', 'cancelled_by_student', 'cancelled_by_tutor', 'expired', 'refunded')
        ) as terminal_count,
        max(start_at_utc) as last_session_at
      from bookings
      group by tutor_id
    ) b on b.tutor_id = t.user_id
    left join (
      select tutor_id, count(*) as trial_count
      from bookings where is_trial and status in ('settled', 'completed')
      group by tutor_id
    ) tr on tr.tutor_id = t.user_id
    left join (
      -- A trial converted when that same student later paid for a session
      -- with that same tutor.
      select trial.tutor_id, count(distinct trial.student_id) as trial_converted_count
      from bookings trial
      where trial.is_trial
        and trial.status in ('settled', 'completed')
        and exists (
          select 1 from bookings paid
          where paid.tutor_id = trial.tutor_id
            and paid.student_id = trial.student_id
            and not paid.is_trial
            and paid.start_at_utc > trial.start_at_utc
        )
      group by trial.tutor_id
    ) cv on cv.tutor_id = t.user_id
    where t.status = 'verified'
      ${
        onlyTutorIds
          ? sql`and t.user_id in (${sql.join(
              onlyTutorIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`
          : sql``
      }
  `)) as unknown as InputRow[];

  // Availability is unknown until Phase 3; the port says so rather than
  // guessing, and the score treats "unknown" as a neutral constant.
  const availability = getAvailability();
  const tutorIds = rows.map((row) => row.tutor_id);
  const density = await availability.densityNext7dBps(tutorIds);

  const breakdowns = rows.map((row) => {
    const inputs: RankingInputs = {
      tutorId: row.tutor_id,
      ratingSum: Number(row.rating_sum),
      reviewCount: Number(row.review_count),
      settledCount: Number(row.settled_count),
      terminalCount: Number(row.terminal_count),
      trialCount: Number(row.trial_count),
      trialConvertedCount: Number(row.trial_converted_count),
      responseMedianSeconds: row.response_median_seconds,
      lastActiveAt: toDate(row.last_active_at),
      verifiedAt: toDate(row.verified_at),
      availabilityDensityBps: density.known ? (density.value.get(row.tutor_id) ?? null) : null,
    };
    return { inputs, breakdown: computeRanking(inputs, now) };
  });

  if (breakdowns.length > 0) {
    await database
      .insert(tutorRanking)
      .values(
        breakdowns.map(({ inputs, breakdown }) => ({
          tutorId: breakdown.tutorId,
          score: breakdown.score,
          bayesianRatingMilli: breakdown.bayesianRatingMilli,
          completionRateBps: breakdown.completionRateBps,
          trialToPaidBps: breakdown.trialToPaidBps,
          availabilityDensityBps: breakdown.availabilityDensityBps,
          responseSpeedBps: breakdown.responseSpeedBps,
          recencyBps: breakdown.recencyBps,
          explorationBoost: breakdown.explorationBoost,
          reviewCount: inputs.reviewCount,
          sessionCount: inputs.settledCount,
          computedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: tutorRanking.tutorId,
        set: {
          score: sql`excluded.score`,
          bayesianRatingMilli: sql`excluded.bayesian_rating_milli`,
          completionRateBps: sql`excluded.completion_rate_bps`,
          trialToPaidBps: sql`excluded.trial_to_paid_bps`,
          availabilityDensityBps: sql`excluded.availability_density_bps`,
          responseSpeedBps: sql`excluded.response_speed_bps`,
          recencyBps: sql`excluded.recency_bps`,
          explorationBoost: sql`excluded.exploration_boost`,
          reviewCount: sql`excluded.review_count`,
          sessionCount: sql`excluded.session_count`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }

  // A tutor who stops being verified should stop being ranked. Only the full
  // run prunes; a single-tutor refresh must not touch anybody else's row.
  if (!onlyTutorIds) {
    await database.execute(sql`
      delete from tutor_ranking
      where tutor_id not in (select user_id from tutor_profiles where status = 'verified')
    `);
  }

  const scores = breakdowns.map(({ breakdown }) => breakdown.score).sort((a, b) => a - b);

  return {
    computedAt: now,
    tutorCount: breakdowns.length,
    availabilitySource: availability.name,
    availabilityKnown: density.known,
    topScore: scores[scores.length - 1] ?? 0,
    medianScore: scores[Math.floor(scores.length / 2)] ?? 0,
  };
}

/**
 * Score one tutor immediately.
 *
 * Called when an admin verifies somebody, so a new tutor is discoverable within
 * seconds rather than waiting for 3am. This is not "ranking in the request
 * path" — it is one row, computed once, on an admin action, written to the same
 * table the feed reads.
 */
export async function recomputeTutorRankingFor(
  tutorId: string,
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<void> {
  await recomputeTutorRanking(database, now, [tutorId]);
}

export function formatRankingRun(run: RankingRun): string {
  const availability = run.availabilityKnown
    ? `availability from ${run.availabilitySource}`
    : `availability unknown (${run.availabilitySource}) — scored neutrally until Phase 3`;

  return `Ranked ${run.tutorCount} verified tutors: top ${run.topScore}, median ${run.medianScore}. ${availability}.`;
}
