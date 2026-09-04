/**
 * Settlement, as a command (SPEC.md §2).
 *
 * `pnpm settle` runs it now. `pnpm settle --at 2026-04-17T00:00:00Z` runs it as
 * if it were that moment, which is how the 24-hour window gets exercised
 * without waiting a day. `--dry-run` lists what it would touch and stops —
 * the only way to ask whether one booking is due without settling every other
 * booking that also is.
 */

import './bootstrap';

import { formatSettlementRun, previewSettlement, runSettlement } from '@/db/settlement';

async function main() {
  const index = process.argv.indexOf('--at');
  const at = index !== -1 ? process.argv[index + 1] : undefined;
  const now = at ? new Date(at) : new Date();

  if (Number.isNaN(now.getTime())) {
    console.error(`"${at}" is not a date`);
    process.exit(1);
  }

  if (process.argv.includes('--dry-run')) {
    const due = await previewSettlement(now);
    console.log(JSON.stringify({ dryRun: true, at: now.toISOString(), due }, null, 2));
    process.exit(0);
  }

  const run = await runSettlement(now);
  console.log(formatSettlementRun(run));

  for (const line of run.settled) {
    console.log(
      `  ${line.bookingId.slice(0, 8)} ${line.resolution.padEnd(18)} refund ${line.refundCents}  tutor ${line.tutorCents}  platform ${line.platformCents}`,
    );
  }

  process.exit(run.skipped.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
