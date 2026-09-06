/**
 * The recurring-series job (SPEC.md §5).
 *
 * Three things, in one pass, because they are the same question asked at three
 * moments: roll every live series four weeks forward, warn a student at T-72h
 * when their wallet will not cover the next session, and at T-48h either take
 * the credits or lapse the occurrence.
 *
 * Run it hourly. Running it every minute would be harmless and running it once
 * a day would mean a warning arriving up to 24 hours late, which is 24 hours
 * of the student's chance to top up.
 *
 *   pnpm series
 *   pnpm series --at 2026-09-20T09:00:00Z    # as if it were then
 *
 * Every step is idempotent — materialisation by a unique index, warnings by a
 * notification dedupe key, charging by the booking's own state machine — so a
 * cron that fires twice does nothing twice.
 */

import './bootstrap';

import { runSeriesJobs } from '@/db/series';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const at = argument('at');
  const now = at ? new Date(at) : new Date();

  if (Number.isNaN(now.getTime())) {
    console.error(`--at ${at} is not a date`);
    process.exit(1);
  }

  const report = await runSeriesJobs(now);

  console.log(`Recurring series at ${now.toISOString()}`);
  console.log(`  series rolled forward   ${report.rolled}`);
  console.log(`  occurrences created     ${report.created}`);
  console.log(`  students warned         ${report.warned}   (T-72h, wallet short)`);
  console.log(`  occurrences charged     ${report.charged}  (T-48h)`);
  console.log(`  occurrences lapsed      ${report.lapsed}   (still short at T-48h)`);
  console.log(`  series closed           ${report.closed}   (notice period over)`);

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
