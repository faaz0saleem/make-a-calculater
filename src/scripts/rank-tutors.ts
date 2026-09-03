/**
 * The nightly ranking job, as a command (SPEC.md §4).
 *
 * Run with `pnpm rank`. In production the same work is triggered by Vercel Cron
 * hitting `/api/cron/rank-tutors`.
 */

import './bootstrap';

import { formatRankingRun, recomputeTutorRanking } from '@/db/ranking';

async function main() {
  const run = await recomputeTutorRanking();
  console.log(formatRankingRun(run));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
