/**
 * Prove the backup (SPEC.md §14).
 *
 *   pnpm prove:restore
 *
 * Takes a real `pg_dump` of the live database, restores it into a scratch one,
 * and then checks the thing that actually matters: that the ledger in the
 * restored copy reconciles and every table has the row count it had before.
 *
 * A backup nobody has restored is a hope. This is the difference between the
 * two, and it is a script rather than a paragraph in a runbook because the only
 * useful version of this claim is one you can re-run at 2am.
 *
 * The scratch database is dropped at the end, including when a check fails —
 * the failure is the output, not a database left lying around.
 */

import './bootstrap';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';

/** Tables whose counts must survive a round trip, in dependency order. */
const CRITICAL_TABLES = [
  'users',
  'tutor_profiles',
  'bookings',
  'ledger_entries',
  'credit_purchases',
  'payouts',
  'recurring_series',
  'email_deliveries',
] as const;

function run(command: string, args: string[], env?: Record<string, string>): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 512 * 1024 * 1024,
  });
}

async function counts(url: string): Promise<Record<string, number>> {
  const sql = postgres(url, { max: 1 });
  const out: Record<string, number> = {};

  try {
    for (const table of CRITICAL_TABLES) {
      const [row] = await sql.unsafe(`select count(*)::int as n from ${table}`);
      out[table] = Number(row?.n ?? 0);
    }
    return out;
  } finally {
    await sql.end();
  }
}

async function main() {
  const source = process.env.DATABASE_URL!;
  const url = new URL(source);
  const scratchName = `tutorly_restore_${Date.now()}`;
  const scratchUrl = new URL(source);
  scratchUrl.pathname = `/${scratchName}`;

  const admin = new URL(source);
  admin.pathname = '/postgres';

  const workdir = mkdtempSync(join(tmpdir(), 'tutorly-restore-'));
  const dumpFile = join(workdir, 'tutorly.dump');

  console.log(`Source     ${url.pathname.slice(1)} on ${url.host}`);
  console.log(`Scratch    ${scratchName}`);
  console.log('');

  const before = await counts(source);
  const started = Date.now();

  try {
    // ---- 1. dump -------------------------------------------------------
    // Custom format, because it is what `pg_restore` can parallelise and
    // selectively restore from — the two things you want at 2am.
    run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--file=${dumpFile}`, source]);
    const dumpSeconds = ((Date.now() - started) / 1000).toFixed(1);
    const size = run('du', ['-h', dumpFile]).split('\t')[0];
    console.log(`Dumped     ${size} in ${dumpSeconds}s`);

    // ---- 2. restore ----------------------------------------------------
    const createSql = postgres(admin.toString(), { max: 1 });
    try {
      await createSql.unsafe(`create database "${scratchName}"`);
    } finally {
      await createSql.end();
    }

    run('pg_restore', ['--no-owner', '--no-privileges', `--dbname=${scratchUrl.toString()}`, dumpFile]);
    console.log(`Restored   into ${scratchName}`);
    console.log('');

    // ---- 3. check ------------------------------------------------------
    const after = await counts(scratchUrl.toString());
    let mismatches = 0;

    for (const table of CRITICAL_TABLES) {
      const ok = before[table] === after[table];
      if (!ok) mismatches += 1;
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${table.padEnd(20)} ${before[table]} -> ${after[table]}`,
      );
    }

    // The row counts could all match and the money still be wrong, so the
    // restored copy is reconciled with the same job that runs nightly.
    const restored = postgres(scratchUrl.toString(), { max: 1 });
    let drift = 0;

    try {
      const [row] = await restored`
        select
          (select coalesce(sum(delta_cents), 0) from ledger_entries where account = 'student_credits')::int
            - (select coalesce(sum(credits_cents), 0) from student_wallets)::int as credits,
          -- Double entry, minus the two legs that legitimately have no partner:
          -- money entering the platform when somebody buys credits, and money
          -- leaving it when a payout is actually sent. Everything in between
          -- must cancel, and a restore that lost rows is what this notices.
          (
            select coalesce(sum(delta_cents), 0)
              - coalesce(sum(delta_cents) filter (where reason in ('credit_purchase', 'payout_paid')), 0)
            from ledger_entries
          )::int as internal,
          (select coalesce(sum(delta_cents) filter (where reason = 'credit_purchase'), 0)
            from ledger_entries)::int as funded,
          (select coalesce(-sum(delta_cents) filter (where reason = 'payout_paid'), 0)
            from ledger_entries)::int as paid_out
      `;

      drift = Number(row?.credits ?? 0);
      console.log('');
      console.log(`  ${drift === 0 ? 'ok  ' : 'FAIL'} student credits match the ledger (drift ${drift})`);
      const internal = Number(row?.internal ?? 0);
      console.log(
        `  ${internal === 0 ? 'ok  ' : 'FAIL'} internal entries cancel (${internal} cents)`,
      );
      console.log(
        `  ok   money in ${Number(row?.funded ?? 0)} cents from purchases, out ${Number(
          row?.paid_out ?? 0,
        )} cents in payouts`,
      );

      if (internal !== 0) mismatches += 1;
    } finally {
      await restored.end();
    }

    console.log('');
    if (mismatches > 0 || drift !== 0) {
      console.error(`RESTORE IS NOT TRUSTWORTHY — ${mismatches} problem(s).`);
      process.exitCode = 1;
    } else {
      console.log(`Restore verified in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
      console.log('The dump restores, every table has the rows it had, and the ledger balances.');
    }
  } finally {
    // Always, including on failure: a scratch database left behind is one more
    // thing to notice later.
    const cleanup = postgres(admin.toString(), { max: 1 });
    try {
      await cleanup.unsafe(`drop database if exists "${scratchName}" with (force)`);
    } catch (error) {
      console.error('could not drop the scratch database', error);
    } finally {
      await cleanup.end();
    }

    rmSync(workdir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
