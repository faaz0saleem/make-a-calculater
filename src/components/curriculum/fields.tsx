'use client';

/**
 * The three-field curriculum picker: board, class, subject.
 *
 * Board-aware, because a level only means something inside a board — an AS
 * Level under CBSE is nonsense, and offering it would be a bug the student has
 * to notice. Choosing a board narrows the class list to that board's, and
 * changing the board clears a class that no longer belongs.
 *
 * Without JavaScript the class list is still correct: every option is grouped
 * under its board with `<optgroup>`, and the level id carries its board, so the
 * pairing cannot come out wrong — the database refuses it either way.
 *
 * The board list is ordered for the viewer's country, with the boards their
 * country actually uses in their own group at the top. Everything else stays
 * on the list underneath: "not used where you are" is not "not available".
 */

import { useId, useState } from 'react';

import { Field, Select } from '@/components/ui/select';

export type BoardChoice = {
  id: string;
  name: string;
  local: boolean;
  levels: { id: string; name: string }[];
};

export type SubjectChoice = { slug: string; name: string };

export function CurriculumFields({
  boards,
  subjects,
  value,
  names = { board: 'board', level: 'level', subject: 'subject' },
  labels = { board: 'Exam board', level: 'Class or level', subject: 'Subject' },
  anySubjectLabel = 'Any subject',
  required = false,
  disabled = false,
}: {
  boards: BoardChoice[];
  subjects: SubjectChoice[];
  value: { board?: string; level?: string; subject?: string };
  names?: { board: string; level: string; subject: string };
  labels?: { board: string; level: string; subject: string };
  anySubjectLabel?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const prefix = useId();
  const [boardId, setBoardId] = useState(value.board ?? '');
  const [levelId, setLevelId] = useState(value.level ?? '');

  const local = boards.filter((board) => board.local);
  const rest = boards.filter((board) => !board.local);
  const selected = boards.find((board) => board.id === boardId);
  // With no board chosen, every class is offered, grouped by board. That is
  // also exactly what a browser with no JavaScript renders.
  const levelBoards = selected ? [selected] : boards;

  return (
    <>
      <Field label={labels.board} htmlFor={`${prefix}-board`}>
        <Select
          id={`${prefix}-board`}
          name={names.board}
          value={boardId}
          required={required}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setBoardId(next);
            // A class from the old board would be a lie about the new one.
            const board = boards.find((candidate) => candidate.id === next);
            if (!board?.levels.some((level) => level.id === levelId)) setLevelId('');
          }}
        >
          <option value="">{required ? 'Choose a board' : 'Any board'}</option>
          {local.length > 0 ? (
            <optgroup label="Used where you are">
              {local.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label={local.length > 0 ? 'All other boards' : 'Boards'}>
            {rest.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>

      <Field label={labels.level} htmlFor={`${prefix}-level`}>
        <Select
          id={`${prefix}-level`}
          name={names.level}
          value={levelId}
          required={required}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setLevelId(next);
            // The level carries its board, so picking one settles the other.
            const owner = boards.find((board) => board.levels.some((level) => level.id === next));
            if (owner) setBoardId(owner.id);
          }}
        >
          <option value="">{required ? 'Choose a class' : 'Any class'}</option>
          {levelBoards.map((board) => (
            <optgroup key={board.id} label={board.name}>
              {board.levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      <Field label={labels.subject} htmlFor={`${prefix}-subject`}>
        <Select
          id={`${prefix}-subject`}
          name={names.subject}
          defaultValue={value.subject ?? ''}
          required={required}
          disabled={disabled}
        >
          <option value="">{anySubjectLabel}</option>
          {subjects.map((subject) => (
            <option key={subject.slug} value={subject.slug}>
              {subject.name}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
