/**
 * Applies the generated SQL migrations in ./drizzle.
 *
 * Run with `pnpm db:migrate`. Safe to run repeatedly — drizzle records what it
 * has applied in a `drizzle.__drizzle_migrations` table.
 */

import '@/scripts/bootstrap';

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { getEnv } from '@/lib/env';

async function main() {
  const { DATABASE_URL } = getEnv();
  const sql = postgres(DATABASE_URL, { max: 1 });
  const database = drizzle(sql);

  console.log('Applying migrations from ./drizzle ...');
  await migrate(database, { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');

  await sql.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
