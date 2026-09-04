/**
 * "Tell us your class and we will show tutors who teach it."
 *
 * Inline in the feed rather than a step in signup: asking a stranger which
 * exam board they sit before they have seen a single tutor is a wall, and a
 * wall is where people leave. Here the question arrives when the answer pays
 * the student back immediately, and skipping it costs them nothing.
 */

import { CurriculumFields, type BoardChoice } from '@/components/curriculum/fields';
import { Button } from '@/components/ui/button';
import { declareMyCurriculum } from '@/app/curriculum/actions';

export function CurriculumPrompt({
  boards,
  subjects,
  returnTo,
  error,
}: {
  boards: BoardChoice[];
  subjects: { slug: string; name: string }[];
  returnTo: string;
  error?: string | null;
}) {
  return (
    <form
      action={declareMyCurriculum}
      className="flex flex-col gap-4 rounded-lg border border-border bg-secondary/40 p-4"
      data-testid="curriculum-prompt"
    >
      <input type="hidden" name="returnTo" value={returnTo} />

      <div>
        <h2 className="text-sm font-semibold">Tell us your class</h2>
        <p className="text-sm text-muted-foreground">
          Say which board and class you are studying and we will show tutors who teach it first. You can
          change it whenever you like.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <CurriculumFields
          boards={boards}
          subjects={subjects}
          value={{}}
          required
          anySubjectLabel="Choose a subject"
          labels={{ board: 'Exam board', level: 'Class or level', subject: 'Subject' }}
        />
      </div>

      <div>
        <Button type="submit" size="sm">
          Show tutors who teach this
        </Button>
      </div>
    </form>
  );
}
