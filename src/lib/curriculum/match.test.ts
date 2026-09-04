import { describe, expect, it } from 'vitest';

import {
  BOARD_SEEDS,
  boardCountrySeedRows,
  boardsForCountry,
  countryIndexFrom,
  type CurriculumStage,
} from './boards';
import { bestTier, isNearMatch, MATCH_TIERS, tierFor, type CurriculumPosition } from './match';

function at(boardId: string, levelId: string, stage: CurriculumStage, subjectId: string): CurriculumPosition {
  return { boardId, levelId, stage, subjectId };
}

const caieAsMaths = at('caie', 'caie:as-level', 'advanced_1', 'maths');
const caieA2Maths = at('caie', 'caie:a2-level', 'advanced_2', 'maths');
const punjab11Maths = at('punjab', 'punjab:class-11', 'advanced_1', 'maths');
const caieAsPhysics = at('caie', 'caie:as-level', 'advanced_1', 'physics');
const cbse11Maths = at('cbse', 'cbse:class-11', 'advanced_1', 'maths');

describe('tierFor', () => {
  it('scores the same board, level and subject as exact', () => {
    expect(tierFor(caieAsMaths, caieAsMaths)).toBe(MATCH_TIERS.exact);
  });

  it('scores the same board and subject at another level below exact', () => {
    expect(tierFor(caieAsMaths, caieA2Maths)).toBe(MATCH_TIERS.board);
  });

  it('scores the same subject and stage on another board below that', () => {
    expect(tierFor(caieAsMaths, punjab11Maths)).toBe(MATCH_TIERS.stage);
  });

  it('ranks the syllabus above the year', () => {
    // The point of the ordering: a CAIE tutor teaching the wrong year beats a
    // Punjab Board tutor teaching the right one.
    expect(tierFor(caieAsMaths, caieA2Maths)).toBeGreaterThan(tierFor(caieAsMaths, punjab11Maths));
  });

  it('scores a different subject as no match at all', () => {
    expect(tierFor(caieAsMaths, caieAsPhysics)).toBe(MATCH_TIERS.none);
  });

  it('scores a different board at a different stage as no match', () => {
    expect(tierFor(caieAsMaths, at('cbse', 'cbse:class-9', 'lower_secondary', 'maths'))).toBe(
      MATCH_TIERS.none,
    );
  });

  it('does not treat two boards that are both across boards as one board', () => {
    // Punjab Class 11 and CBSE Class 11 are the same stage, so they near-match.
    expect(tierFor(punjab11Maths, cbse11Maths)).toBe(MATCH_TIERS.stage);
    // But that is a near match, never an exact one.
    expect(tierFor(punjab11Maths, cbse11Maths)).toBeLessThan(MATCH_TIERS.exact);
  });

  it('never near-matches through the catch-all board', () => {
    const other = at('other', 'other:college', 'advanced_2', 'maths');
    // "Not listed" tells us nothing about the syllabus, so it earns nothing.
    expect(tierFor(caieA2Maths, other)).toBe(MATCH_TIERS.none);
    expect(tierFor(other, caieA2Maths)).toBe(MATCH_TIERS.none);
    // It still matches itself exactly, which is what a shared level means.
    expect(tierFor(other, other)).toBe(MATCH_TIERS.exact);
  });
});

describe('bestTier', () => {
  it('takes the best pairing rather than an average', () => {
    const student = [caieAsMaths, caieAsPhysics];
    const tutor = [caieAsPhysics, at('ib', 'ib:dp-1', 'advanced_1', 'chemistry')];
    expect(bestTier(student, tutor)).toBe(MATCH_TIERS.exact);
  });

  it('is none when nothing lines up', () => {
    expect(bestTier([caieAsMaths], [at('ap', 'ap:grade-9', 'lower_secondary', 'chemistry')])).toBe(
      MATCH_TIERS.none,
    );
  });

  it('is none with nothing declared on either side', () => {
    expect(bestTier([], [caieAsMaths])).toBe(MATCH_TIERS.none);
    expect(bestTier([caieAsMaths], [])).toBe(MATCH_TIERS.none);
  });
});

describe('isNearMatch', () => {
  it('accepts anything that shares a subject with a real relationship', () => {
    expect(isNearMatch(MATCH_TIERS.exact)).toBe(true);
    expect(isNearMatch(MATCH_TIERS.board)).toBe(true);
    expect(isNearMatch(MATCH_TIERS.stage)).toBe(true);
    expect(isNearMatch(MATCH_TIERS.none)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The seeds themselves
// ---------------------------------------------------------------------------

describe('BOARD_SEEDS', () => {
  it('gives every board a unique id and every level a namespaced one', () => {
    const boardIds = new Set(BOARD_SEEDS.map((board) => board.id));
    expect(boardIds.size).toBe(BOARD_SEEDS.length);

    for (const board of BOARD_SEEDS) {
      for (const level of board.levels) {
        expect(level.id.startsWith(`${board.id}:`)).toBe(true);
      }
    }
  });

  it('never shares a level id between boards', () => {
    const levelIds = BOARD_SEEDS.flatMap((board) => board.levels.map((level) => level.id));
    expect(new Set(levelIds).size).toBe(levelIds.length);
  });

  it('always offers the catch-all board, last', () => {
    const other = BOARD_SEEDS.find((board) => board.id === 'other');
    expect(other).toBeDefined();
    expect(Math.max(...BOARD_SEEDS.map((board) => board.sortOrder))).toBe(other!.sortOrder);
  });

  it('has no board claiming a level of another board', () => {
    for (const board of BOARD_SEEDS) {
      for (const level of board.levels) {
        expect(level.id.split(':')[0]).toBe(board.id);
      }
    }
  });
});

describe('boardsForCountry', () => {
  const index = countryIndexFrom(boardCountrySeedRows());
  const options = BOARD_SEEDS.map(({ id, name, sortOrder }) => ({ id, name, sortOrder }));

  it('does not make a Lahore student scroll past CBSE', () => {
    const ordered = boardsForCountry(options, 'PK', index).map((board) => board.id);
    const local = ordered.slice(0, 4);
    expect(local).toEqual(['caie', 'edexcel', 'punjab', 'federal']);
    expect(ordered.indexOf('cbse')).toBeGreaterThan(ordered.indexOf('federal'));
  });

  it('shapes the list differently for the UAE and the UK', () => {
    const uae = boardsForCountry(options, 'AE', index);
    const uk = boardsForCountry(options, 'GB', index);

    // The UAE runs CAIE, IB and CBSE schools; AQA and OCR are domestic English
    // boards and belong below the fold there.
    expect(uae.filter((board) => board.local).map((b) => b.id)).toEqual([
      'caie',
      'edexcel',
      'ib',
      'cbse',
    ]);
    expect(uae.findIndex((b) => b.id === 'cbse')).toBeLessThan(uae.findIndex((b) => b.id === 'aqa'));

    // In the UK it is the other way round: AQA and OCR are local, CBSE is not.
    expect(uk.filter((board) => board.local).map((b) => b.id)).toEqual([
      'caie',
      'edexcel',
      'ib',
      'aqa',
      'ocr',
    ]);
    expect(uk.findIndex((b) => b.id === 'ocr')).toBeLessThan(uk.findIndex((b) => b.id === 'cbse'));

    // And Punjab Board, which is nobody's board but Pakistan's, is local in
    // neither.
    expect(uae.find((b) => b.id === 'punjab')!.local).toBe(false);
    expect(uk.find((b) => b.id === 'punjab')!.local).toBe(false);
  });

  it('is case-insensitive about the country code', () => {
    expect(boardsForCountry(options, 'pk', index).map((b) => b.id)).toEqual(
      boardsForCountry(options, 'PK', index).map((b) => b.id),
    );
  });

  it('still offers every board to a country nobody listed', () => {
    const ordered = boardsForCountry(options, 'ZW', index);
    expect(ordered.length).toBe(BOARD_SEEDS.length);
    expect(ordered.every((board) => !board.local)).toBe(true);
    expect(ordered[ordered.length - 1]!.id).toBe('other');
  });

  it('falls back to the global order with no country at all', () => {
    expect(boardsForCountry(options, null, index).map((b) => b.id)).toEqual(
      [...options].sort((a, b) => a.sortOrder - b.sortOrder).map((b) => b.id),
    );
  });

  it('marks which boards were surfaced because of the country', () => {
    const ordered = boardsForCountry(options, 'PK', index);
    expect(ordered.filter((board) => board.local).map((b) => b.id)).toEqual([
      'caie',
      'edexcel',
      'punjab',
      'federal',
    ]);
  });
});
