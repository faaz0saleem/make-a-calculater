/**
 * The line that says why this feed looks like this.
 *
 * A student who has told us their class gets it applied to the feed by
 * default. That is only fair if it is *visible* and reversible in one tap —
 * otherwise the feed is quietly hiding tutors and the student cannot tell.
 *
 * Three states, all of them honest:
 *  - applied: what is being matched on, and a way to see everyone
 *  - cleared: that nothing is being matched on, and a way to put it back
 *  - filtered by hand: the same, described as the student's own filter
 */

import Link from 'next/link';

export type CurriculumSummary = {
  boardName: string;
  levelName: string;
  subjectName: string;
};

export function CurriculumBanner({
  applied,
  source,
  restoreHref,
  clearHref,
}: {
  applied: CurriculumSummary | null;
  /** `profile` when it came from the student's declared class. */
  source: 'profile' | 'filter';
  restoreHref: string;
  clearHref: string;
}) {
  if (!applied) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm"
        data-testid="curriculum-banner"
        data-state="cleared"
      >
        <p className="text-muted-foreground">Showing every tutor, not just the ones who teach your class.</p>
        <span className="flex items-center gap-4">
          <Link href={restoreHref} className="font-medium underline underline-offset-4">
            Match my class again
          </Link>
          <Link href="/settings/curriculum" className="text-muted-foreground underline underline-offset-4">
            My classes
          </Link>
        </span>
      </div>
    );
  }

  const position = `${applied.boardName} · ${applied.levelName} · ${applied.subjectName}`;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm"
      data-testid="curriculum-banner"
      data-state="applied"
      data-source={source}
    >
      <p>
        {source === 'profile' ? 'Matching your class: ' : 'Filtered to: '}
        <strong className="font-semibold" data-testid="curriculum-position">
          {position}
        </strong>
        {source === 'profile' ? (
          <span className="text-muted-foreground"> — tutors who teach it come first.</span>
        ) : null}
      </p>
      <span className="flex items-center gap-4">
        <Link href={clearHref} className="font-medium underline underline-offset-4">
          {source === 'profile' ? 'Show all tutors' : 'Clear'}
        </Link>
        {source === 'profile' ? (
          <Link href="/settings/curriculum" className="text-muted-foreground underline underline-offset-4">
            Change
          </Link>
        ) : null}
      </span>
    </div>
  );
}
