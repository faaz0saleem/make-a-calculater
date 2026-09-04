'use server';

/**
 * Declaring where you are in a curriculum.
 *
 * Who is declaring always comes from the session. A form carries a board, a
 * class and a subject — never a user id, and never a role.
 *
 * The board-and-class pairing is not validated here, because it does not need
 * to be: `tutor_curriculum` and `student_curriculum` both carry a composite
 * foreign key onto `curriculum_levels (board_id, id)`, so Postgres refuses an
 * AS Level under CBSE whatever this file does. What is checked here is the
 * thing the database cannot know — that the subject slug names a real subject.
 */

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  addStudentCurriculum,
  CurriculumError,
  removeStudentCurriculum,
  setPrimaryStudentCurriculum,
  setTutorCurriculum,
  type CurriculumTriple,
} from '@/db/curriculum';
import { db } from '@/db/client';
import { subjects } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';

async function subjectIdFor(slug: string): Promise<string | null> {
  const [row] = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.slug, slug)).limit(1);
  return row?.id ?? null;
}

/** Slug to id for the whole taxonomy — one query, however many rows a form has. */
async function subjectIdsBySlug(): Promise<Map<string, string>> {
  const rows = await db.select({ id: subjects.id, slug: subjects.slug }).from(subjects);
  return new Map(rows.map((row) => [row.slug, row.id]));
}

function readTriple(formData: FormData): { boardId: string; levelId: string; subjectSlug: string } | null {
  const boardId = String(formData.get('board') ?? '').trim();
  const levelId = String(formData.get('level') ?? '').trim();
  const subjectSlug = String(formData.get('subject') ?? '').trim();

  if (!boardId || !levelId || !subjectSlug) return null;
  return { boardId, levelId, subjectSlug };
}

/**
 * A student says which board, class and subject they are studying.
 *
 * The first one becomes their primary position, which is what the feed applies
 * by default. Later ones sit alongside it.
 */
export async function declareMyCurriculum(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = readTriple(formData);
  const back = String(formData.get('returnTo') ?? '/') || '/';

  if (!parsed) {
    redirect(`${back}${back.includes('?') ? '&' : '?'}curriculumError=incomplete`);
  }

  const subjectId = await subjectIdFor(parsed.subjectSlug);
  if (!subjectId) {
    redirect(`${back}${back.includes('?') ? '&' : '?'}curriculumError=subject`);
  }

  const triple: CurriculumTriple = {
    boardId: parsed.boardId,
    levelId: parsed.levelId,
    subjectId,
  };

  if (String(formData.get('secondary') ?? '') === '1') {
    await addStudentCurriculum(user.id, triple);
  } else {
    await setPrimaryStudentCurriculum(user.id, triple);
  }

  revalidatePath('/');
  revalidatePath('/settings/curriculum');
  redirect(back);
}

export async function removeMyCurriculum(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');
  const back = String(formData.get('returnTo') ?? '/settings/curriculum') || '/settings/curriculum';

  if (id) await removeStudentCurriculum(user.id, id);

  revalidatePath('/');
  revalidatePath('/settings/curriculum');
  redirect(back);
}

/**
 * A tutor replaces the whole list of what they teach.
 *
 * Whole-list rather than one-at-a-time because that is how the screen works:
 * fifteen checkboxes submitted together, and a save that is the new truth. The
 * cap and the "subject must already be on your profile" rule both live in
 * `setTutorCurriculum`, inside one transaction.
 */
export async function saveTutorCurriculum(formData: FormData): Promise<void> {
  const user = await requireUser();
  const back = String(formData.get('returnTo') ?? '/tutor') || '/tutor';

  // Three parallel lists, zipped by position. Browsers submit controls in
  // document order, so row *i*'s board, class and subject line up — which means
  // the form works without JavaScript, where combining three selects into one
  // value would not. A row missing any field is not a position yet.
  const boardIds = formData.getAll('positionBoard').map(String);
  const levelIds = formData.getAll('positionLevel').map(String);
  const subjectSlugs = formData.getAll('positionSubject').map(String);
  const idBySlug = await subjectIdsBySlug();

  const triples: CurriculumTriple[] = [];
  for (let index = 0; index < boardIds.length; index += 1) {
    const boardId = boardIds[index]?.trim();
    const levelId = levelIds[index]?.trim();
    const subjectId = idBySlug.get(subjectSlugs[index]?.trim() ?? '');
    if (boardId && levelId && subjectId) triples.push({ boardId, levelId, subjectId });
  }

  try {
    await setTutorCurriculum(user.id, triples);
  } catch (error) {
    if (error instanceof CurriculumError) {
      redirect(`${back}${back.includes('?') ? '&' : '?'}curriculumError=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  revalidatePath('/tutor');
  revalidatePath(`/tutors/${user.id}`);
  redirect(`${back}${back.includes('?') ? '&' : '?'}saved=curriculum`);
}
