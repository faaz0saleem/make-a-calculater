/**
 * The Postgres connection and the Drizzle client.
 *
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * pool on every save, so the client is cached on `globalThis`.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { getEnv } from '@/lib/env';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

function createDatabase() {
  const { DATABASE_URL, NODE_ENV } = getEnv();

  const sql = postgres(DATABASE_URL, {
    // Serverless-friendly: one connection per lambda, plenty for a pooled URL.
    max: NODE_ENV === 'production' ? 1 : 10,
    prepare: false,
  });

  return drizzle(sql, { schema, casing: 'snake_case', logger: false });
}

const globalForDb = globalThis as unknown as { tutorlyDb?: Database };

export const db: Database = globalForDb.tutorlyDb ?? createDatabase();

if (getEnv().NODE_ENV !== 'production') {
  globalForDb.tutorlyDb = db;
}

export { schema };
