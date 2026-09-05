'use client';

/**
 * What a tutor teaches, as board-class-subject positions.
 *
 * A row is one position. Rows are added and removed on the page, and the whole
 * list is saved at once, because that is what the tutor is deciding — "this is
 * everything I teach" — rather than fifteen separate facts.
 *
 * The three selects submit as three parallel lists, zipped by row index in the
 * action. Combining them into one value would need JavaScript; this way the
 * form still works without it, one row at a time.
 *
 * The subject list is only the subjects already on the tutor's profile. The
 * same rule is enforced again in `setTutorCurriculum`, because a select is a
 * suggestion and a transaction is a guarantee.
 */

import { useState } from 'react';

import { CurriculumFields, type BoardChoice, type SubjectChoice } from '@/components/curriculum/fields';
import { Button } from '@/components/ui/button';
import { saveTutorCurriculum } from '@/app/curriculum/actions';

export type Position = { boardId: string; levelId: string; subjectSlug: string };

let nextKey = 0;

export function TutorPositions({
  boards,
  subjects,
  positions,
  max,
  returnTo,
  error,
}: {
  boards: BoardChoice[];
  subjects: SubjectChoice[];
  positions: Position[];
  max: number;
  returnTo: string;
  error?: string | null;
}) {
  const [rows, setRows] = useState(() =>
    // Always one blank row, so the first position takes no extra click.
    [...positions, { boardId: '', levelId: '', subjectSlug: '' }].map((position) => ({
      key: (nextKey += 1),
      ...position,
    })),
  );

  const filled = rows.filter((row) => row.boardId && row.levelId && row.subjectSlug).length;
  const atCap = rows.length >= max;

  if (subjects.length === 0) {
    return (
      <p className="rounded-md border border-border px-3 py-4 text-sm text-muted-foreground">
        Save your subjects first. Boards and classes are chosen per subject, so there is nothing to pick
        until this list has something in it.
      </p>
    );
  }

  return (
    <form action={saveTutorCurriculum} className="flex flex-col gap-4">
      <input type="hidden" name="returnTo" value={returnTo} />

      <p className="text-sm text-muted-foreground">
        Which exam board and class do you teach each subject for? Students are matched on this, so a tutor
        who teaches the CAIE syllabus is shown to CAIE students first. Up to {max}.
      </p>

      {error ? (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
            data-testid="curriculum-row"
          >
            <CurriculumFields
              boards={boards}
              subjects={subjects}
              value={{ board: row.boardId, level: row.levelId, subject: row.subjectSlug }}
              names={{
                board: 'positionBoard',
                level: 'positionLevel',
                subject: 'positionSubject',
              }}
              labels={{ board: 'Exam board', level: 'Class or level', subject: 'Subject' }}
              anySubjectLabel="Choose a subject"
            />

            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}
                aria-label={`Remove position ${index + 1}`}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={atCap}
          onClick={() =>
            setRows((current) => [
              ...current,
              { key: (nextKey += 1), boardId: '', levelId: '', subjectSlug: '' },
            ])
          }
        >
          Add another
        </Button>

        <Button type="submit" size="sm">
          Save what I teach
        </Button>

        <p className="text-xs text-muted-foreground">
          {filled} of {max} used.
          {atCap ? ' That is the limit — remove one to add another.' : ''}
        </p>
      </div>
    </form>
  );
}
