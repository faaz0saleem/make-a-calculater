/**
 * The reminder job (SPEC.md §7).
 *
 * Run it every five minutes. The tightest reminder is T-10min with a
 * twenty-minute grace window, so a five-minute cadence sends it on time and a
 * fifteen-minute one still sends it; hourly would miss it entirely.
 *
 *   pnpm reminders
 *   pnpm reminders --at 2026-09-15T12:50:00Z    # as if it were then
 *
 * Safe to run twice: the bell dedupes on a unique index, and the outbound
 * provider dedupes on the same key as a client reference.
 */

import './bootstrap';

import { sendDueReminders } from '@/db/reminders';

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

  const report = await sendDueReminders(now);

  console.log(`Reminders at ${now.toISOString()}`);
  console.log(`  sessions with something due  ${report.sessions}`);
  console.log(`  in-app                       ${report.inApp}`);
  console.log(`  to a phone                   ${report.outbound}`);
  console.log(`  no number, or not worth one  ${report.skipped}`);
  console.log(`  failed to send               ${report.failed}`);
  console.log(`  unaccepted bookings expired  ${report.expired}  (refunded in full)`);

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
