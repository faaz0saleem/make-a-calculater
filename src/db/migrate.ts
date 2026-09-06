/**
 * Applies the generated SQL migrations in ./drizzle.
 *
 * Run with `pnpm db:migrate`. Safe to run repeatedly, and safe to run against a
 * database that is part-way through: each file gets **its own transaction**,
 * and the same `drizzle.__drizzle_migrations` bookkeeping drizzle-kit uses, so
 * nothing here is a private format.
 *
 * Why not drizzle's own `migrate()`: it wraps every pending file in one
 * transaction, and Postgres refuses to *use* an enum value in the transaction
 * that added it — `ALTER TYPE ... ADD VALUE 'scheduled'` followed anywhere
 * later by an index predicate mentioning `'scheduled'` fails with 55P04, "new
 * enum values must be committed before they can be used". Splitting the change
 * across two files does not help while both files share a transaction.
 *
 * This schema grows enums regularly — booking statuses, notification kinds,
 * sanction levels — so the choice is either this, or remembering to apply
 * migrations one at a time by hand for the rest of the project's life.
 *
 * The cost, stated plainly: a run that fails half way leaves the earlier files
 * applied. That is the normal contract for migrations everywhere else, and it
 * is recorded honestly — the failed file is not marked applied, so a re-run
 * picks up exactly where it stopped.
 */

import '@/scripts/bootstrap';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import postgres from 'postgres';

import { getEnv } from '@/lib/env';

const FOLDER = './drizzle';

type JournalEntry = { idx: number; tag: string };

/** The same hash drizzle-kit records: sha256 of the file, verbatim. */
function hashOf(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function main() {
  const { DATABASE_URL } = getEnv();
  const sql = postgres(DATABASE_URL, { max: 1 });

  const journal = JSON.parse(
    await readFile(join(FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };

  await sql.unsafe(`create schema if not exists drizzle`);
  await sql.unsafe(`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);

  const applied = new Set(
    (
      (await sql.unsafe(`select hash from drizzle.__drizzle_migrations`)) as unknown as {
        hash: string;
      }[]
    ).map((row) => row.hash),
  );

  let ran = 0;

  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const contents = await readFile(join(FOLDER, `${entry.tag}.sql`), 'utf8');
    const hash = hashOf(contents);
    if (applied.has(hash)) continue;

    const statements = contents
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);

    // One transaction per file. Everything in a file lands or none of it does.
    await sql.begin(async (tx) => {
      for (const statement of statements) await tx.unsafe(statement);
      await tx.unsafe(
        `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
        [hash, Date.now()],
      );
    });

    console.log(`  applied ${entry.tag}`);
    ran += 1;
  }

  console.log(ran === 0 ? 'Migrations already applied.' : `Migrations applied: ${ran}.`);
  await sql.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
