/**
 * Proof that a price change never reaches a booking that already happened.
 *
 *   pnpm prove:rates
 *
 * Commission moved from 20/15 to 22/16. The rule is that the rate is decided
 * once, at creation, and snapshotted — so a booking settled last month keeps
 * the rate it was priced at, and the tutor's payout for it does not move
 * because we changed a constant.
 *
 * "The ledger reconciles" does not prove that. Reconciliation compares the
 * materialised balances against the ledger; both would agree perfectly with
 * each other after a wrong rewrite. So this checks two different things:
 *
 *  1. Nothing the nightly jobs do changes a terminal booking's snapshot. The
 *     fingerprint before and after has to be identical.
 *  2. The money that actually moved matches each booking's **own** snapshot
 *     rather than today's constant. That is the assertion that catches a
 *     rewrite the fingerprint would miss, because it reads the ledger.
 *
 * Read-only apart from running the real jobs, which are idempotent.
 */

import './bootstrap';

import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { reconcileLedger } from '@/db/ledger';
import { pruneSessionEventBodies } from '@/db/retention';
import { runSettlement } from '@/db/settlement';
import {
  FIRST_BOOKING_COMMISSION_BPS,
  REBOOKING_COMMISSION_BPS,
} from '@/lib/money/commission';
import { TERMINAL_BOOKING_STATUSES } from '@/lib/bookings/status';

type Fingerprint = { id: string; status: string; commission_bps: number; price_cents: number };

async function fingerprint(): Promise<Fingerprint[]> {
  return (await db.execute(sql`
    select id::text as id, status::text as status, commission_bps, price_cents
    from bookings
    where status in (${sql.join(
      TERMINAL_BOOKING_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    )})
    order by id
  `)) as unknown as Fingerprint[];
}

async function main() {
  const before = await fingerprint();

  if (before.length === 0) {
    console.error('No terminal bookings to check. Run `pnpm seed` first.');
    process.exit(1);
  }

  const rates = new Map<number, number>();
  for (const row of before) rates.set(row.commission_bps, (rates.get(row.commission_bps) ?? 0) + 1);

  console.log(`${before.length} bookings in a terminal state, by snapshotted rate:`);
  for (const [bps, count] of [...rates].sort((a, b) => a[0] - b[0])) {
    const note =
      bps === FIRST_BOOKING_COMMISSION_BPS || bps === REBOOKING_COMMISSION_BPS
        ? ' (a rate we charge today)'
        : ' (a rate we no longer charge)';
    console.log(`  ${(bps / 100).toFixed(0)}%  ${String(count).padStart(4)}${note}`);
  }

  // The jobs that touch settled money. If any of them reprices, this catches it.
  const settlement = await runSettlement();
  const retention = await pruneSessionEventBodies();
  const reconciliation = await reconcileLedger();

  console.log(
    `\nRan the nightly jobs: settled ${settlement.settled.length}, pruned ${retention.bodiesDropped}, ` +
      `ledger drift ${reconciliation.drifts.length === 0 ? 'none' : reconciliation.drifts.length}.`,
  );

  const after = await fingerprint();
  const byId = new Map(after.map((row) => [row.id, row]));

  const moved = before.filter((row) => {
    const now = byId.get(row.id);
    return !now || now.commission_bps !== row.commission_bps || now.price_cents !== row.price_cents;
  });

  // A settled booking's platform share, as the ledger actually recorded it,
  // against what its own snapshot says it should be.
  const mismatched = (await db.execute(sql`
    select
      b.id::text as id,
      b.commission_bps,
      b.price_cents,
      coalesce(sum(l.delta_cents) filter (where l.account = 'platform_revenue'), 0)::int as platform_cents,
      coalesce(sum(l.delta_cents) filter (where l.account in ('tutor_pending', 'tutor_available')), 0)::int as tutor_cents
    from bookings b
    join ledger_entries l on l.booking_id = b.id
    where b.status = 'settled' and not b.is_trial
    group by b.id
    having coalesce(sum(l.delta_cents) filter (where l.account = 'platform_revenue'), 0)
         <> floor(
              (coalesce(sum(l.delta_cents) filter (where l.account = 'platform_revenue'), 0)
               + coalesce(sum(l.delta_cents) filter (where l.account in ('tutor_pending', 'tutor_available')), 0))
              * b.commission_bps / 10000.0
            )
  `)) as unknown as { id: string; commission_bps: number }[];

  const held = moved.length === 0 && mismatched.length === 0 && reconciliation.drifts.length === 0;

  console.log(
    moved.length === 0
      ? 'OK    no terminal booking changed its price or its rate'
      : `FAIL  ${moved.length} terminal bookings changed: ${moved.slice(0, 5).map((row) => row.id).join(', ')}`,
  );
  console.log(
    mismatched.length === 0
      ? 'OK    every settled booking was split at its own snapshotted rate'
      : `FAIL  ${mismatched.length} settled bookings were split at some other rate`,
  );

  console.log(
    held
      ? '\nThe rate change reached no booking that already existed.'
      : '\nA settled booking moved. Do not deploy this.',
  );
  process.exit(held ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
