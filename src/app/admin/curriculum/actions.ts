'use server';

/**
 * Editing the board and class list (SPEC.md §4).
 *
 * These are shipped as a seed and then owned by admin, because a curriculum
 * list is never finished: boards rename themselves, countries reform their
 * exams, and a market we have not launched in yet will need a board nobody
 * here has heard of. Waiting for a deploy to add one is how a student ends up
 * picking "Other".
 *
 * Nothing here deletes. A board or class a tutor has declared against cannot
 * simply vanish — `is_active` takes it out of every picker while leaving the
 * declarations that already point at it intact. Every change writes an audit
 * row, because this decides who gets matched to whom.
 */

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { boardCountries, boards, curriculumLevels } from '@/db/schema';
import { requestIp, writeAudit } from '@/lib/admin/audit';
import { requireRole } from '@/lib/auth/guards';
import { CURRICULUM_STAGES, type CurriculumStage } from '@/lib/curriculum/boards';

const HERE = '/admin/curriculum';

function fail(message: string): never {
  redirect(`${HERE}?error=${encodeURIComponent(message)}`);
}

/** Slugs are ids, appear in URLs, and prefix every level under the board. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

function done(): never {
  revalidatePath(HERE);
  revalidatePath('/');
  redirect(`${HERE}?saved=1`);
}

export async function saveBoard(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');

  const id = String(formData.get('boardId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const sortOrder = Number(formData.get('sortOrder') ?? 0);
  const isActive = String(formData.get('isActive') ?? '') === 'on';
  // Comma-separated ISO 3166-1 alpha-2 codes, in the order they should appear.
  const countries = String(formData.get('countries') ?? '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));

  if (!id || !name || !Number.isInteger(sortOrder)) fail('A board needs a name and a position.');

  const [before] = await db
    .select({ name: boards.name, sortOrder: boards.sortOrder, isActive: boards.isActive })
    .from(boards)
    .where(eq(boards.id, id))
    .limit(1);

  if (!before) fail('No such board.');

  await db.transaction(async (tx) => {
    await tx
      .update(boards)
      .set({ name, sortOrder, isActive, updatedAt: new Date() })
      .where(eq(boards.id, id));

    // Whole-list replace: the form submits the order the admin wants, and a
    // country dropped from it should stop surfacing the board.
    await tx.delete(boardCountries).where(eq(boardCountries.boardId, id));
    if (countries.length > 0) {
      await tx.insert(boardCountries).values(
        countries.map((country, index) => ({ boardId: id, country, sortOrder: index })),
      );
    }

    await writeAudit(tx, {
      actorId: admin.id,
      action: 'curriculum.board.update',
      targetType: 'board',
      targetId: null,
      before,
      after: { id, name, sortOrder, isActive, countries },
      reason: 'curriculum edit',
      ip: await requestIp(),
    });
  });

  done();
}

export async function addBoard(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');

  const id = String(formData.get('boardId') ?? '')
    .trim()
    .toLowerCase();
  const name = String(formData.get('name') ?? '').trim();

  if (!SLUG.test(id)) fail('A board id is lower-case letters, digits and hyphens.');
  if (!name) fail('A board needs a name.');

  const [existing] = await db.select({ id: boards.id }).from(boards).where(eq(boards.id, id)).limit(1);
  if (existing) fail(`There is already a board called "${id}".`);

  const [{ next }] = (await db.execute(
    sql`select coalesce(max(sort_order), 0) + 1 as next from boards where id <> 'other'`,
  )) as unknown as [{ next: number }];

  await db.transaction(async (tx) => {
    await tx.insert(boards).values({ id, name, sortOrder: Number(next) });

    await writeAudit(tx, {
      actorId: admin.id,
      action: 'curriculum.board.create',
      targetType: 'board',
      targetId: null,
      before: null,
      after: { id, name },
      reason: 'curriculum edit',
      ip: await requestIp(),
    });
  });

  done();
}

export async function addLevel(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');

  const boardId = String(formData.get('boardId') ?? '').trim();
  const suffix = String(formData.get('levelId') ?? '')
    .trim()
    .toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const stage = String(formData.get('stage') ?? '') as CurriculumStage;
  const sortOrder = Number(formData.get('sortOrder') ?? 0);

  if (!SLUG.test(suffix)) fail('A class id is lower-case letters, digits and hyphens.');
  if (!name) fail('A class needs a name.');
  if (!CURRICULUM_STAGES.includes(stage)) fail('Pick which rung this class sits on.');

  const [board] = await db.select({ id: boards.id }).from(boards).where(eq(boards.id, boardId)).limit(1);
  if (!board) fail('No such board.');

  // Namespaced, because a class only means something inside its board.
  const id = `${boardId}:${suffix}`;

  const [existing] = await db
    .select({ id: curriculumLevels.id })
    .from(curriculumLevels)
    .where(eq(curriculumLevels.id, id))
    .limit(1);
  if (existing) fail(`${board.id} already has a class called "${suffix}".`);

  await db.transaction(async (tx) => {
    await tx.insert(curriculumLevels).values({
      id,
      boardId,
      name,
      stage,
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    });

    await writeAudit(tx, {
      actorId: admin.id,
      action: 'curriculum.level.create',
      targetType: 'curriculum_level',
      targetId: null,
      before: null,
      after: { id, boardId, name, stage, sortOrder },
      reason: 'curriculum edit',
      ip: await requestIp(),
    });
  });

  done();
}

/**
 * Retire or restore a class.
 *
 * Never a delete: tutors and students have declared against it, and their
 * history is not ours to rewrite. Inactive simply stops it being offered.
 */
export async function toggleLevel(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');

  const id = String(formData.get('levelId') ?? '').trim();
  const boardId = String(formData.get('boardId') ?? '').trim();

  const [before] = await db
    .select({ isActive: curriculumLevels.isActive, name: curriculumLevels.name })
    .from(curriculumLevels)
    .where(and(eq(curriculumLevels.id, id), eq(curriculumLevels.boardId, boardId)))
    .limit(1);

  if (!before) fail('No such class.');

  await db.transaction(async (tx) => {
    await tx
      .update(curriculumLevels)
      .set({ isActive: !before.isActive })
      .where(eq(curriculumLevels.id, id));

    await writeAudit(tx, {
      actorId: admin.id,
      action: before.isActive ? 'curriculum.level.retire' : 'curriculum.level.restore',
      targetType: 'curriculum_level',
      targetId: null,
      before,
      after: { id, isActive: !before.isActive },
      reason: 'curriculum edit',
      ip: await requestIp(),
    });
  });

  done();
}
