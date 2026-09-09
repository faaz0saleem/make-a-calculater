/**
 * Prove that a tutor cannot lock more than they have.
 *
 * The booking proof's sibling, for the other side of the money. Fires N
 * genuinely parallel `requestPayout` calls — separate connections, separate
 * transactions, all in flight at once — each asking for the tutor's *whole*
 * available balance. Exactly one may succeed, and `payout_locked` must end up
 * equal to that one request rather than to N of them.
 *
 *   pnpm prove:payout
 *   pnpm prove:payout --clients 5
 *
 * Sequential calls would prove nothing. The question is what Postgres does
 * when several transactions read the same available balance before any of them
 * has written, and the answer is supposed to be the `select ... for update` on
 * `tutor_profiles` inside `requestPayout`: the second transaction blocks until
 * the first commits, then re-reads a balance of zero and is refused.
 */

import './bootstrap';

import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requestPayout } from '@/db/payouts';
import { PAYOUT_THRESHOLD_CENTS } from '@/lib/money/payouts';

type Candidate = { id: string; email: string; available: number };

async function main() {
  const index = process.argv.indexOf('--clients');
  const clients = index === -1 ? 3 : Math.max(2, Math.min(Number(process.argv[index + 1]), 10));

  // A tutor over the threshold, with somewhere to be paid, and nothing already
  // in flight — an open request would make "exactly one succeeds" untrue for a
  // reason that has nothing to do with locking.
  const [tutor] = (await db.execute(sql`
    select u.id::text, u.email, p.available_cents::int as available
    from tutor_profiles p
    join users u on u.id = p.user_id
    where p.available_cents >= ${PAYOUT_THRESHOLD_CENTS}
      and u.email_verified_at is not null
      and exists (select 1 from payout_methods m where m.tutor_id = p.user_id)
      and not exists (
        select 1 from payouts o
        where o.tutor_id = p.user_id and o.status in ('requested', 'approved', 'processing')
      )
    order by p.available_cents desc
    limit 1
  `)) as unknown as Candidate[];

  if (!tutor) {
    throw new Error(
      'no tutor is over the payout threshold with a method on file and nothing in flight — run `pnpm seed` first',
    );
  }

  const before = tutor.available;

  // Everything above is preparation. This is the test: all of them at once,
  // each asking for the entire balance, none of them waiting for the others.
  const results = await Promise.all(
    Array.from({ length: clients }, () => requestPayout(tutor.id, before)),
  );

  const [after] = (await db.execute(sql`
    select p.available_cents::int as available,
           p.payout_locked_cents::int as locked,
           (select count(*)::int from payouts o
             where o.tutor_id = ${tutor.id}::uuid
               and o.status in ('requested', 'approved', 'processing')) as open_payouts,
           (select coalesce(sum(l.delta_cents), 0)::int from ledger_entries l
             where l.owner_id = ${tutor.id}::uuid and l.account = 'payout_locked') as ledger_locked
      from tutor_profiles p
     where p.user_id = ${tutor.id}::uuid
  `)) as unknown as { available: number; locked: number; open_payouts: number; ledger_locked: number }[];

  const succeeded = results.filter((result) => result.ok).length;

  const report = {
    tutorEmail: tutor.email,
    clients,
    availableBefore: before,
    eachRequested: before,
    succeeded,
    refusals: results.filter((result) => !result.ok).map((result) => (result as { reason: string }).reason),
    availableAfter: after?.available ?? 0,
    lockedAfter: after?.locked ?? 0,
    ledgerLocked: after?.ledger_locked ?? 0,
    openPayouts: after?.open_payouts ?? 0,
  };

  console.log(JSON.stringify(report, null, 2));

  // The four things that must all be true. Printed rather than asserted would
  // make this a demo; a script that exits non-zero is a check.
  const problems: string[] = [];
  if (succeeded !== 1) problems.push(`${succeeded} of ${clients} requests succeeded, expected exactly 1`);
  if (report.lockedAfter !== before) {
    problems.push(`locked ${report.lockedAfter}, expected ${before}`);
  }
  if (report.availableAfter !== 0) {
    problems.push(`available ${report.availableAfter} after locking the whole balance, expected 0`);
  }
  if (report.ledgerLocked !== report.lockedAfter) {
    problems.push(`ledger says ${report.ledgerLocked} locked, the column says ${report.lockedAfter}`);
  }
  if (report.openPayouts !== 1) {
    problems.push(`${report.openPayouts} open payouts, expected 1`);
  }

  if (problems.length > 0) {
    console.error(`\nFAILED:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  console.log('\nExactly one request won. Nothing locked more than the balance.');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
