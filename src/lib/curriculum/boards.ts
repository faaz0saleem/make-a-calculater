/**
 * Curriculum boards and the levels inside them.
 *
 * A subject on its own is too coarse to match on. "Maths" is the same word for
 * a Year 9 Punjab Board student and an IB Diploma one, and a tutor who is
 * excellent at one may be no use at all for the other. So a curriculum
 * position is three fields — board, level, subject — and everything about
 * matching hangs off the triple rather than the subject.
 *
 * **A level only means something inside a board.** "AS Level" under CBSE is
 * nonsense, so levels belong to boards and the picker is board-aware. That is
 * why the level ids are namespaced: `caie:as-level`, never a global `as-level`
 * that half the boards would have to pretend to understand.
 *
 * These are the shipped defaults. They are written into the database by the
 * seed and edited by an admin from there; nothing in the product reads this
 * file at runtime except the seed.
 */

/**
 * The rung of school a level sits on, in words that mean the same thing across
 * every board.
 *
 * Levels themselves are board-scoped and deliberately not comparable — but a
 * student on CAIE AS Level and one in Class 11 under the Punjab Board are at
 * the same point in their education, and a tutor who teaches one is at least
 * plausible for the other. The stage is the only thing that survives crossing
 * a board boundary, and it is what the near-match tier in `./match.ts` uses.
 */
export const CURRICULUM_STAGES = [
  'lower_secondary',
  'upper_secondary',
  'advanced_1',
  'advanced_2',
  'tertiary',
  'other',
] as const;

export type CurriculumStage = (typeof CURRICULUM_STAGES)[number];

export const STAGE_LABELS: Record<CurriculumStage, string> = {
  lower_secondary: 'Lower secondary',
  upper_secondary: 'Upper secondary',
  advanced_1: 'Advanced, first year',
  advanced_2: 'Advanced, final year',
  tertiary: 'Tertiary',
  other: 'Other',
};

export type LevelSeed = {
  id: string;
  name: string;
  stage: CurriculumStage;
  sortOrder: number;
};

export type BoardSeed = {
  id: string;
  name: string;
  /** Where it appears when no country says otherwise. */
  sortOrder: number;
  /** Countries that should see it first, most relevant first. */
  countries: string[];
  levels: LevelSeed[];
};

/** Levels shared by the English exam boards, which do genuinely line up. */
function britishLevels(board: string, gcseName: string): LevelSeed[] {
  return [
    { id: `${board}:year-9`, name: 'Year 9', stage: 'lower_secondary', sortOrder: 1 },
    { id: `${board}:year-10`, name: 'Year 10', stage: 'lower_secondary', sortOrder: 2 },
    { id: `${board}:${gcseName.toLowerCase()}`, name: gcseName, stage: 'upper_secondary', sortOrder: 3 },
    { id: `${board}:as-level`, name: 'AS Level', stage: 'advanced_1', sortOrder: 4 },
    { id: `${board}:a2-level`, name: 'A2 Level', stage: 'advanced_2', sortOrder: 5 },
  ];
}

/**
 * Levels for the Pakistani and Indian boards, in the words they use.
 *
 * Class 11 maps to `advanced_1`, alongside AS Level and IB DP 1 — nearer AS
 * than A2, which is where it sits by age. That is **not** a claim that FSc Part
 * I and AS Level are the same qualification. They are not: FSc is broader, more
 * memorisation-heavy, and its exam technique is a different skill entirely,
 * which is precisely the thing a tutor is hired to teach. Content overlaps in
 * maths and physics; papers do not.
 *
 * So the mapping earns only the weakest match tier — "same subject, same rung,
 * another board" — and is deliberately never upgraded above it.
 */
function southAsianLevels(board: string, matric: string, intermediate: string): LevelSeed[] {
  return [
    { id: `${board}:class-9`, name: 'Class 9', stage: 'lower_secondary', sortOrder: 1 },
    { id: `${board}:class-10`, name: `Class 10 (${matric})`, stage: 'upper_secondary', sortOrder: 2 },
    { id: `${board}:class-11`, name: `Class 11 (${intermediate} I)`, stage: 'advanced_1', sortOrder: 3 },
    { id: `${board}:class-12`, name: `Class 12 (${intermediate} II)`, stage: 'advanced_2', sortOrder: 4 },
  ];
}

export const BOARD_SEEDS: readonly BoardSeed[] = [
  {
    id: 'caie',
    name: 'Cambridge (CAIE)',
    sortOrder: 1,
    countries: ['PK', 'AE', 'QA', 'SA', 'OM', 'BH', 'KW', 'GB', 'IN', 'BD', 'MY', 'SG'],
    levels: [
      { id: 'caie:year-9', name: 'Year 9', stage: 'lower_secondary', sortOrder: 1 },
      { id: 'caie:year-10', name: 'Year 10', stage: 'lower_secondary', sortOrder: 2 },
      { id: 'caie:igcse', name: 'IGCSE', stage: 'upper_secondary', sortOrder: 3 },
      { id: 'caie:o-level', name: 'O Level', stage: 'upper_secondary', sortOrder: 4 },
      { id: 'caie:as-level', name: 'AS Level', stage: 'advanced_1', sortOrder: 5 },
      { id: 'caie:a2-level', name: 'A2 Level', stage: 'advanced_2', sortOrder: 6 },
    ],
  },
  {
    id: 'edexcel',
    name: 'Pearson Edexcel',
    sortOrder: 2,
    countries: ['PK', 'GB', 'AE', 'QA', 'SA'],
    levels: [
      { id: 'edexcel:year-9', name: 'Year 9', stage: 'lower_secondary', sortOrder: 1 },
      { id: 'edexcel:year-10', name: 'Year 10', stage: 'lower_secondary', sortOrder: 2 },
      { id: 'edexcel:igcse', name: 'International GCSE', stage: 'upper_secondary', sortOrder: 3 },
      { id: 'edexcel:gcse', name: 'GCSE', stage: 'upper_secondary', sortOrder: 4 },
      { id: 'edexcel:as-level', name: 'AS Level', stage: 'advanced_1', sortOrder: 5 },
      { id: 'edexcel:a2-level', name: 'A2 Level', stage: 'advanced_2', sortOrder: 6 },
    ],
  },
  {
    id: 'punjab',
    name: 'Punjab Board',
    sortOrder: 3,
    countries: ['PK'],
    levels: southAsianLevels('punjab', 'Matric', 'FSc'),
  },
  {
    id: 'federal',
    name: 'Federal Board (FBISE)',
    sortOrder: 4,
    countries: ['PK'],
    levels: southAsianLevels('federal', 'Matric', 'FSc'),
  },
  {
    id: 'ib',
    name: 'International Baccalaureate',
    sortOrder: 5,
    countries: ['AE', 'QA', 'SG', 'GB', 'US', 'IN'],
    levels: [
      { id: 'ib:myp-4', name: 'MYP 4', stage: 'lower_secondary', sortOrder: 1 },
      { id: 'ib:myp-5', name: 'MYP 5', stage: 'upper_secondary', sortOrder: 2 },
      { id: 'ib:dp-1', name: 'Diploma Year 1', stage: 'advanced_1', sortOrder: 3 },
      { id: 'ib:dp-2', name: 'Diploma Year 2', stage: 'advanced_2', sortOrder: 4 },
    ],
  },
  {
    id: 'cbse',
    name: 'CBSE',
    sortOrder: 6,
    countries: ['IN', 'AE', 'QA', 'SA', 'OM', 'KW'],
    levels: southAsianLevels('cbse', 'Secondary', 'Senior Secondary'),
  },
  {
    id: 'aqa',
    name: 'AQA',
    sortOrder: 7,
    countries: ['GB'],
    levels: britishLevels('aqa', 'GCSE'),
  },
  {
    id: 'ocr',
    name: 'OCR',
    sortOrder: 8,
    countries: ['GB'],
    levels: britishLevels('ocr', 'GCSE'),
  },
  {
    id: 'ap',
    name: 'Advanced Placement (AP)',
    sortOrder: 9,
    countries: ['US', 'CA'],
    levels: [
      { id: 'ap:grade-9', name: 'Grade 9', stage: 'lower_secondary', sortOrder: 1 },
      { id: 'ap:grade-10', name: 'Grade 10', stage: 'upper_secondary', sortOrder: 2 },
      { id: 'ap:grade-11', name: 'Grade 11', stage: 'advanced_1', sortOrder: 3 },
      { id: 'ap:grade-12', name: 'Grade 12', stage: 'advanced_2', sortOrder: 4 },
    ],
  },
  {
    /**
     * Always present, always last. A curriculum list that cannot express where
     * somebody actually is teaches them that the product is not for them.
     */
    id: 'other',
    name: 'Other / not listed',
    sortOrder: 99,
    countries: [],
    levels: [
      { id: 'other:school', name: 'School level', stage: 'upper_secondary', sortOrder: 1 },
      { id: 'other:college', name: 'College level', stage: 'advanced_2', sortOrder: 2 },
      { id: 'other:university', name: 'University level', stage: 'tertiary', sortOrder: 3 },
      { id: 'other:adult', name: 'Adult / professional', stage: 'other', sortOrder: 4 },
    ],
  },
] as const;

export type BoardOption = {
  id: string;
  name: string;
  sortOrder: number;
  /** True when this board was surfaced because of the viewer's country. */
  local: boolean;
};

/**
 * The board list, ordered for one country.
 *
 * A student in Lahore should not scroll past CBSE to find Punjab Board. The
 * boards their country actually uses come first, in the order that country
 * uses them; everything else follows in the global order, because "not listed
 * for your country" is not the same as "not available".
 */
export function boardsForCountry<T extends { id: string; name: string; sortOrder: number }>(
  boards: readonly T[],
  country: string | null | undefined,
  countryIndex: ReadonlyMap<string, readonly string[]>,
): (T & { local: boolean })[] {
  const code = country?.toUpperCase() ?? '';
  const local = countryIndex.get(code) ?? [];
  const rank = new Map(local.map((id, index) => [id, index]));

  return [...boards]
    .map((board) => ({ ...board, local: rank.has(board.id) }))
    .sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);

      if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
      if (aRank !== undefined) return -1;
      if (bRank !== undefined) return 1;

      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });
}

/**
 * The `board_countries` rows the seeds imply.
 *
 * A board's rank inside a country starts as its global rank. That is not the
 * same thing as being redundant: the column exists so an admin can promote a
 * board for one country without disturbing anywhere else — Punjab Board above
 * Cambridge in Pakistan, say — and the seed simply has no opinion about that
 * yet.
 */
export function boardCountrySeedRows(): { boardId: string; country: string; sortOrder: number }[] {
  return BOARD_SEEDS.flatMap((board) =>
    board.countries.map((country) => ({
      boardId: board.id,
      country,
      sortOrder: board.sortOrder,
    })),
  );
}

/** The country hints from the seeds, as the index `boardsForCountry` wants. */
export function countryIndexFrom(
  rows: readonly { boardId: string; country: string; sortOrder: number }[],
): Map<string, string[]> {
  const index = new Map<string, { boardId: string; sortOrder: number }[]>();

  for (const row of rows) {
    const list = index.get(row.country) ?? [];
    list.push({ boardId: row.boardId, sortOrder: row.sortOrder });
    index.set(row.country, list);
  }

  return new Map(
    [...index].map(([country, list]) => [
      country,
      list.sort((a, b) => a.sortOrder - b.sortOrder).map((entry) => entry.boardId),
    ]),
  );
}
