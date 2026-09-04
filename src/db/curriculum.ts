/**
 * Curriculum: boards, levels, and who declares what (SPEC.md §4).
 *
 * A curriculum position is three fields — board, level, subject. Two things in
 * here are worth reading before changing anything:
 *
 *  1. A level belongs to a board. `tutor_curriculum` and `student_curriculum`
 *     both carry a composite foreign key onto `(board_id, id)`, so an AS Level
 *     under CBSE is not a validation error the app raises — it is a row
 *     Postgres refuses to store.
 *  2. The board list is shaped by country, never filtered by it. A student in
 *     Lahore meets Punjab Board before CBSE; a student in Lagos still gets the
 *     whole list, because "not listed for your country" is not "not available".
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import {
  boardCountrySeedRows,
  boardsForCountry,
  BOARD_SEEDS,
  countryIndexFrom,
} from '@/lib/curriculum/boards';
import type { CurriculumStage } from '@/lib/curriculum/boards';
import type { CurriculumPosition } from '@/lib/curriculum/match';
import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import {
  boardCountries,
  boards,
  curriculumLevels,
  MAX_TUTOR_CURRICULUM,
  studentCurriculum,
  subjects,
  tutorCurriculum,
  users,
} from './schema';

export { MAX_TUTOR_CURRICULUM };

export class CurriculumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurriculumError';
  }
}

export type LevelOption = {
  id: string;
  boardId: string;
  name: string;
  stage: CurriculumStage;
};

export type BoardOption = {
  id: string;
  name: string;
  /** True when the viewer's country is one this board is used in. */
  local: boolean;
  levels: LevelOption[];
};

/** A stored triple, resolved into the names a screen needs to render it. */
export type CurriculumEntry = {
  boardId: string;
  boardName: string;
  levelId: string;
  levelName: string;
  stage: CurriculumStage;
  subjectId: string;
  subjectSlug: string;
  subjectName: string;
};

export type StudentCurriculumEntry = CurriculumEntry & { id: string; isPrimary: boolean };

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

/**
 * Every active board with its levels, ordered for one country.
 *
 * One round trip, because the picker is board-aware: choosing a board rewrites
 * the level list, and a second request per keystroke would make that feel
 * broken on a slow connection.
 */
export async function listCurriculumOptions(
  country: string | null | undefined,
  database: DbLike = defaultDb,
): Promise<BoardOption[]> {
  const [boardRows, levelRows, countryRows] = await Promise.all([
    database
      .select({ id: boards.id, name: boards.name, sortOrder: boards.sortOrder })
      .from(boards)
      .where(eq(boards.isActive, true)),
    database
      .select({
        id: curriculumLevels.id,
        boardId: curriculumLevels.boardId,
        name: curriculumLevels.name,
        stage: curriculumLevels.stage,
      })
      .from(curriculumLevels)
      .where(eq(curriculumLevels.isActive, true))
      .orderBy(asc(curriculumLevels.sortOrder), asc(curriculumLevels.name)),
    database
      .select({
        boardId: boardCountries.boardId,
        country: boardCountries.country,
        sortOrder: boardCountries.sortOrder,
      })
      .from(boardCountries),
  ]);

  const levelsByBoard = new Map<string, LevelOption[]>();
  for (const level of levelRows) {
    const list = levelsByBoard.get(level.boardId) ?? [];
    list.push(level);
    levelsByBoard.set(level.boardId, list);
  }

  return boardsForCountry(boardRows, country, countryIndexFrom(countryRows)).map((board) => ({
    id: board.id,
    name: board.name,
    local: board.local,
    levels: levelsByBoard.get(board.id) ?? [],
  }));
}

/**
 * Everything a curriculum picker needs for one viewer, in one round of queries.
 *
 * The country decides the *order* of the board list and nothing else. A
 * signed-in user's own `users.country` wins; `fallbackCountry` is the guess
 * made from a visitor's timezone, which is only ever a starting point. Either
 * way every board stays on the list.
 */
export async function curriculumContextFor(
  userId: string | null,
  fallbackCountry: string | null,
  database: DbLike = defaultDb,
): Promise<{ country: string | null; boards: BoardOption[]; declared: StudentCurriculumEntry[] }> {
  const [profile, declared] = await Promise.all([
    userId
      ? database.select({ country: users.country }).from(users).where(eq(users.id, userId)).limit(1)
      : Promise.resolve([]),
    userId ? getStudentCurriculum(userId, database) : Promise.resolve([] as StudentCurriculumEntry[]),
  ]);

  const country = profile[0]?.country ?? fallbackCountry;
  return { country, boards: await listCurriculumOptions(country, database), declared };
}

/** Board and level names by id, for rendering a stored triple. */
export async function loadCurriculumLabels(database: DbLike = defaultDb) {
  const rows = await database
    .select({
      levelId: curriculumLevels.id,
      levelName: curriculumLevels.name,
      stage: curriculumLevels.stage,
      boardId: boards.id,
      boardName: boards.name,
    })
    .from(curriculumLevels)
    .innerJoin(boards, eq(boards.id, curriculumLevels.boardId));

  return new Map(rows.map((row) => [row.levelId, row]));
}

// ---------------------------------------------------------------------------
// Reading declarations
// ---------------------------------------------------------------------------

const ENTRY_COLUMNS = {
  boardId: boards.id,
  boardName: boards.name,
  levelId: curriculumLevels.id,
  levelName: curriculumLevels.name,
  stage: curriculumLevels.stage,
  subjectId: subjects.id,
  subjectSlug: subjects.slug,
  subjectName: subjects.name,
} as const;

export async function getTutorCurriculum(
  tutorId: string,
  database: DbLike = defaultDb,
): Promise<CurriculumEntry[]> {
  return database
    .select(ENTRY_COLUMNS)
    .from(tutorCurriculum)
    .innerJoin(boards, eq(boards.id, tutorCurriculum.boardId))
    .innerJoin(curriculumLevels, eq(curriculumLevels.id, tutorCurriculum.levelId))
    .innerJoin(subjects, eq(subjects.id, tutorCurriculum.subjectId))
    .where(eq(tutorCurriculum.tutorId, tutorId))
    .orderBy(asc(boards.sortOrder), asc(curriculumLevels.sortOrder), asc(subjects.name));
}

export async function getStudentCurriculum(
  studentId: string,
  database: DbLike = defaultDb,
): Promise<StudentCurriculumEntry[]> {
  return database
    .select({ ...ENTRY_COLUMNS, id: studentCurriculum.id, isPrimary: studentCurriculum.isPrimary })
    .from(studentCurriculum)
    .innerJoin(boards, eq(boards.id, studentCurriculum.boardId))
    .innerJoin(curriculumLevels, eq(curriculumLevels.id, studentCurriculum.levelId))
    .innerJoin(subjects, eq(subjects.id, studentCurriculum.subjectId))
    .where(eq(studentCurriculum.studentId, studentId))
    // The primary position first: it is the one the feed applies by default.
    .orderBy(sql`${studentCurriculum.isPrimary} desc`, asc(studentCurriculum.createdAt));
}

/** The primary position, or null if the student has not told us where they are. */
export async function getPrimaryStudentCurriculum(
  studentId: string,
  database: DbLike = defaultDb,
): Promise<StudentCurriculumEntry | null> {
  const [row] = await database
    .select({ ...ENTRY_COLUMNS, id: studentCurriculum.id, isPrimary: studentCurriculum.isPrimary })
    .from(studentCurriculum)
    .innerJoin(boards, eq(boards.id, studentCurriculum.boardId))
    .innerJoin(curriculumLevels, eq(curriculumLevels.id, studentCurriculum.levelId))
    .innerJoin(subjects, eq(subjects.id, studentCurriculum.subjectId))
    .where(and(eq(studentCurriculum.studentId, studentId), eq(studentCurriculum.isPrimary, true)))
    .limit(1);

  return row ?? null;
}

export function toPosition(entry: CurriculumEntry): CurriculumPosition {
  return {
    boardId: entry.boardId,
    levelId: entry.levelId,
    stage: entry.stage,
    subjectId: entry.subjectId,
  };
}

// ---------------------------------------------------------------------------
// Writing declarations
// ---------------------------------------------------------------------------

export type CurriculumTriple = {
  boardId: string;
  levelId: string;
  subjectId: string;
};

function dedupe(triples: readonly CurriculumTriple[]): CurriculumTriple[] {
  const seen = new Map<string, CurriculumTriple>();
  for (const triple of triples) {
    seen.set(`${triple.boardId}|${triple.levelId}|${triple.subjectId}`, triple);
  }
  return [...seen.values()];
}

/**
 * Replace a tutor's declared positions.
 *
 * The cap lives here rather than in a database trigger. A trigger firing per
 * row would have to count the table on every insert, and the honest reason for
 * the limit is a product one — fifteen is where a list stops being a claim and
 * starts being a net — so it belongs where the product decision is readable.
 * The transaction is what stops two concurrent saves stepping over it.
 *
 * The subject of every triple must be one the tutor has already declared in
 * `tutor_subjects`. That keeps the profile's subject list and the matching
 * positions from telling a student two different stories.
 */
export async function setTutorCurriculum(
  tutorId: string,
  triples: readonly CurriculumTriple[],
  database: DbLike = defaultDb,
): Promise<CurriculumEntry[]> {
  const wanted = dedupe(triples);

  if (wanted.length > MAX_TUTOR_CURRICULUM) {
    throw new CurriculumError(
      `A tutor can teach at most ${MAX_TUTOR_CURRICULUM} board-and-class combinations; you chose ${wanted.length}.`,
    );
  }

  const run = async (tx: DbLike) => {
    if (wanted.length > 0) {
      const declared = await tx
        .select({ subjectId: sql<string>`ts.subject_id` })
        .from(sql`tutor_subjects ts`)
        .where(sql`ts.tutor_id = ${tutorId}`);

      const allowed = new Set(declared.map((row) => row.subjectId));
      const stray = wanted.find((triple) => !allowed.has(triple.subjectId));
      if (stray) {
        throw new CurriculumError(
          'Add the subject to your profile before saying which boards you teach it for.',
        );
      }
    }

    await tx.delete(tutorCurriculum).where(eq(tutorCurriculum.tutorId, tutorId));

    if (wanted.length > 0) {
      await tx
        .insert(tutorCurriculum)
        .values(wanted.map((triple) => ({ tutorId, ...triple })));
    }

    return getTutorCurriculum(tutorId, tx);
  };

  return 'transaction' in database
    ? database.transaction((tx) => run(tx as DbLike))
    : run(database);
}

/**
 * Set the student's primary position, moving any previous primary aside.
 *
 * Both writes are in one transaction because the partial unique index means
 * they cannot both be true for a moment: clearing the old primary and setting
 * the new one is a single change, not two.
 */
export async function setPrimaryStudentCurriculum(
  studentId: string,
  triple: CurriculumTriple,
  database: DbLike = defaultDb,
): Promise<StudentCurriculumEntry[]> {
  const run = async (tx: DbLike) => {
    await tx
      .update(studentCurriculum)
      .set({ isPrimary: false })
      .where(and(eq(studentCurriculum.studentId, studentId), eq(studentCurriculum.isPrimary, true)));

    await tx
      .insert(studentCurriculum)
      .values({ studentId, ...triple, isPrimary: true })
      .onConflictDoUpdate({
        target: [
          studentCurriculum.studentId,
          studentCurriculum.boardId,
          studentCurriculum.levelId,
          studentCurriculum.subjectId,
        ],
        set: { isPrimary: true },
      });

    return getStudentCurriculum(studentId, tx);
  };

  return 'transaction' in database
    ? database.transaction((tx) => run(tx as DbLike))
    : run(database);
}

/** Add a secondary position — a student taking a second subject, say. */
export async function addStudentCurriculum(
  studentId: string,
  triple: CurriculumTriple,
  database: DbLike = defaultDb,
): Promise<StudentCurriculumEntry[]> {
  await database
    .insert(studentCurriculum)
    .values({ studentId, ...triple, isPrimary: false })
    .onConflictDoNothing();

  return getStudentCurriculum(studentId, database);
}

/**
 * Remove one of a student's positions.
 *
 * Scoped by student id in the same statement rather than checked first: a
 * client-supplied row id is never trusted to belong to the caller.
 */
export async function removeStudentCurriculum(
  studentId: string,
  id: string,
  database: DbLike = defaultDb,
): Promise<StudentCurriculumEntry[]> {
  const run = async (tx: DbLike) => {
    const [removed] = await tx
      .delete(studentCurriculum)
      .where(and(eq(studentCurriculum.id, id), eq(studentCurriculum.studentId, studentId)))
      .returning({ isPrimary: studentCurriculum.isPrimary });

    // Deleting the primary must not leave the student with positions but no
    // default, or the feed would quietly stop matching.
    if (removed?.isPrimary) {
      const [next] = await tx
        .select({ id: studentCurriculum.id })
        .from(studentCurriculum)
        .where(eq(studentCurriculum.studentId, studentId))
        .orderBy(asc(studentCurriculum.createdAt))
        .limit(1);

      if (next) {
        await tx
          .update(studentCurriculum)
          .set({ isPrimary: true })
          .where(eq(studentCurriculum.id, next.id));
      }
    }

    return getStudentCurriculum(studentId, tx);
  };

  return 'transaction' in database
    ? database.transaction((tx) => run(tx as DbLike))
    : run(database);
}

// ---------------------------------------------------------------------------
// Seeding the shipped defaults
// ---------------------------------------------------------------------------

/**
 * Write the shipped board list.
 *
 * Idempotent, so it can run on a fresh database or over an existing one. Boards
 * and levels an admin has since edited keep their names — only membership is
 * asserted — and nothing is deleted, because a board a tutor has declared
 * against cannot simply vanish.
 */
export async function seedCurriculum(database: DbLike = defaultDb): Promise<void> {
  await database
    .insert(boards)
    .values(
      BOARD_SEEDS.map((board) => ({
        id: board.id,
        name: board.name,
        sortOrder: board.sortOrder,
      })),
    )
    .onConflictDoNothing();

  await database
    .insert(curriculumLevels)
    .values(
      BOARD_SEEDS.flatMap((board) =>
        board.levels.map((level) => ({
          id: level.id,
          boardId: board.id,
          name: level.name,
          stage: level.stage,
          sortOrder: level.sortOrder,
        })),
      ),
    )
    .onConflictDoNothing();

  await database.insert(boardCountries).values(boardCountrySeedRows()).onConflictDoNothing();
}

/** Every level, keyed by id — the seed and the admin screens both want this. */
export async function levelIndex(
  database: DbLike = defaultDb,
): Promise<Map<string, { boardId: string; stage: CurriculumStage }>> {
  const rows = await database
    .select({ id: curriculumLevels.id, boardId: curriculumLevels.boardId, stage: curriculumLevels.stage })
    .from(curriculumLevels);

  return new Map(rows.map((row) => [row.id, { boardId: row.boardId, stage: row.stage }]));
}

/** Levels that exist for a set of boards, for validating a submitted triple. */
export async function levelsForBoards(
  boardIds: readonly string[],
  database: DbLike = defaultDb,
): Promise<LevelOption[]> {
  if (boardIds.length === 0) return [];

  return database
    .select({
      id: curriculumLevels.id,
      boardId: curriculumLevels.boardId,
      name: curriculumLevels.name,
      stage: curriculumLevels.stage,
    })
    .from(curriculumLevels)
    .where(and(inArray(curriculumLevels.boardId, [...boardIds]), eq(curriculumLevels.isActive, true)))
    .orderBy(asc(curriculumLevels.sortOrder));
}
