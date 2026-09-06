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

import { recomputeAllResponseMedians } from './messages';
import { getAvailability } from '@/lib/availability';
import { computeRanking, type RankingInputs } from '@/lib/ranking/score';
import { restrictedUserIds } from './reports';
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
  strikes: number | null;
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
      t.verified_at,
      t.strikes
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

  // The port answers `unknown` for a tutor who has published no hours at all,
  // and the score treats that as a neutral constant rather than a zero — an
  // empty calendar is missing information, not a bad tutor.
  const availability = getAvailability();
  const tutorIds = rows.map((row) => row.tutor_id);
  const signals = await availability.weeklySignals(tutorIds);

  // Asked once for the whole run rather than per tutor. A restriction is rare,
  // so this set is almost always empty and almost always free.
  const restricted = await restrictedUserIds(database, now);

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
      availabilityDensityBps: signals.known
        ? (signals.value.get(row.tutor_id)?.densityBps ?? null)
        : null,
      strikes: Number(row.strikes ?? 0),
      restricted: restricted.has(row.tutor_id),
    };
    return {
      inputs,
      breakdown: computeRanking(inputs, now),
      // The tutor half of the timezone-overlap term. Derived here, nightly,
      // because expanding a week of rules per request is exactly the work the
      // "never rank in the request path" rule exists to prevent.
      freeHoursMask: signals.known
        ? (signals.value.get(row.tutor_id)?.freeHoursMask ?? 0)
        : 0,
    };
  });

  if (breakdowns.length > 0) {
    await database
      .insert(tutorRanking)
      .values(
        breakdowns.map(({ inputs, breakdown, freeHoursMask }) => ({
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
          freeHoursMask,
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
          freeHoursMask: sql`excluded.free_hours_mask`,
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
    availabilityKnown: signals.known,
    topScore: scores[scores.length - 1] ?? 0,
    medianScore: scores[Math.floor(scores.length / 2)] ?? 0,
  };
}

/**
 * The whole nightly job: refresh the derived inputs, then score.
 *
 * `response_speed` is a ranking term computed from messages, so it belongs to
 * the same run rather than to whenever a tutor last happened to reply. Keeping
 * both steps in one exported function means a new caller cannot rank against a
 * median that is a week old.
 */
export async function runNightlyRanking(
  database: DbLike = defaultDb,
  now = new Date(),
): Promise<RankingRun> {
  await recomputeAllResponseMedians(now, database);
  return recomputeTutorRanking(database, now);
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
