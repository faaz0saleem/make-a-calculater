/**
 * Drain the email outbox by hand (SPEC.md §11).
 *
 *   pnpm email
 *   pnpm email --limit 200
 *
 * Safe to run while the cron runs: rows are claimed with `for update skip
 * locked`, and the provider is given an idempotency key besides.
 */

import './bootstrap';

import { emailQueueHealth } from '@/db/email';
import { drainEmailQueue } from '@/db/email-queue';
import { emailIsConfigured, getEmailProvider } from '@/lib/email';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const limit = Number(argument('limit') ?? 50);
  const provider = getEmailProvider();

  if (!emailIsConfigured()) {
    console.log('RESEND_API_KEY and EMAIL_FROM are not set — using the mock transport.');
    console.log('Nothing will leave this machine. See LAUNCH.md for the production values.\n');
  }

  const report = await drainEmailQueue(new Date(), limit);
  const health = await emailQueueHealth();

  console.log(`Email drain via ${provider.name}`);
  console.log(`  attempted   ${report.attempted}`);
  console.log(`  sent        ${report.sent}`);
  console.log(`  retrying    ${report.retrying}`);
  console.log(`  dead        ${report.dead}`);
  console.log(`  expired     ${report.expired}`);
  console.log('');
  console.log(`  still queued        ${health.queued}`);
  console.log(`  dead letters total  ${health.dead}`);
  if (health.oldestQueuedMinutes !== null) {
    console.log(`  oldest queued       ${health.oldestQueuedMinutes} minutes`);
  }

  process.exit(report.dead > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
