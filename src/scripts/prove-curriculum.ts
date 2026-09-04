/**
 * Proof that the database, not the app, is what refuses a nonsense curriculum.
 *
 *   pnpm prove:curriculum
 *
 * Two claims are worth being able to demonstrate rather than assert:
 *
 *  1. "An AS level under CBSE is nonsense" — the composite foreign key onto
 *     `curriculum_levels (board_id, id)` makes that row unstorable. Delete the
 *     validation in the server action and this still fails.
 *  2. A student has exactly one primary position. The partial unique index
 *     enforces it, so two concurrent saves cannot both win.
 *
 * Writes nothing that survives: every row it inserts is rolled back.
 */

import './bootstrap';

import { sql } from 'drizzle-orm';

import { db } from '@/db/client';

class Rollback extends Error {}

function pgCode(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: string }).code;
    if (typeof code === 'string' && /^\d/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return (error as Error).message.slice(0, 100);
}

async function main() {
  const [student] = (await db.execute(
    sql`select id::text as id from users where 'student' = any(roles) limit 1`,
  )) as unknown as [{ id: string } | undefined];
  const [subject] = (await db.execute(
    sql`select id::text as id from subjects limit 1`,
  )) as unknown as [{ id: string } | undefined];

  if (!student || !subject) {
    console.error('No seeded student or subject. Run `pnpm seed` first.');
    process.exit(1);
  }

  const results: { claim: string; held: boolean; detail: string }[] = [];

  /**
   * Each claim gets its own transaction, always rolled back.
   *
   * A failed statement poisons the whole transaction in Postgres, so the second
   * claim cannot be tested inside the transaction the first one aborted.
   */
  async function attempt(claim: string, write: (tx: typeof db) => Promise<void>) {
    try {
      await db.transaction(async (tx) => {
        await write(tx as unknown as typeof db);
        throw new Rollback();
      });
      results.push({ claim, held: false, detail: 'the row was stored' });
    } catch (error) {
      if (error instanceof Rollback) {
        results.push({ claim, held: false, detail: 'the row was stored' });
        return;
      }
      results.push({ claim, held: true, detail: `refused, SQLSTATE ${pgCode(error)}` });
    }
  }

  await attempt('AS Level under CBSE', async (tx) => {
    await tx.execute(sql`
      insert into student_curriculum (student_id, board_id, level_id, subject_id, is_primary)
      values (${student.id}::uuid, 'cbse', 'caie:as-level', ${subject.id}::uuid, false)
    `);
  });

  await attempt('Two primary positions', async (tx) => {
    await tx.execute(sql`
      insert into student_curriculum (student_id, board_id, level_id, subject_id, is_primary)
      values (${student.id}::uuid, 'cbse', 'cbse:class-11', ${subject.id}::uuid, true)
    `);
    await tx.execute(sql`
      insert into student_curriculum (student_id, board_id, level_id, subject_id, is_primary)
      values (${student.id}::uuid, 'caie', 'caie:as-level', ${subject.id}::uuid, true)
    `);
  });

  await attempt('A level that does not exist', async (tx) => {
    await tx.execute(sql`
      insert into student_curriculum (student_id, board_id, level_id, subject_id, is_primary)
      values (${student.id}::uuid, 'caie', 'caie:phd', ${subject.id}::uuid, false)
    `);
  });

  for (const result of results) {
    console.log(`${result.held ? 'OK  ' : 'FAIL'}  ${result.claim.padEnd(28)} ${result.detail}`);
  }

  const held = results.every((result) => result.held);
  console.log(
    held
      ? '\nThe database refuses all three. Nothing was left behind.'
      : '\nA guarantee did not hold.',
  );
  process.exit(held ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
