/**
 * What an admin can do about a report (SPEC.md §10).
 *
 * Every one of these takes a reason, and the reason is not for us — it is what
 * the person on the other end reads. "Dismissed" with no explanation is how a
 * moderation queue becomes a grievance queue.
 *
 * There is no `ban` in this list, for the reason set out at the top of
 * `./sanctions.ts`.
 */

export const REPORT_ACTIONS = [
  {
    id: 'dismissed',
    label: 'Nothing to answer',
    blurb: 'No rule was broken. The report is closed and nobody is told off.',
    /** Whether the action lands a sanction on the person reported. */
    sanction: null,
  },
  {
    id: 'warned',
    label: 'Warn them',
    blurb: 'They keep everything and are asked to read and acknowledge a warning.',
    sanction: 'warning',
  },
  {
    id: 'restricted',
    label: 'Restrict new students',
    blurb: 'No new trial requests and no ranking boost. Existing students untouched.',
    sanction: 'restriction',
  },
  {
    id: 'escalated',
    label: 'Send to human review',
    blurb: 'A person reads the whole history. They can teach normally meanwhile.',
    sanction: 'review',
  },
  {
    id: 'content_removed',
    label: 'Hide the review',
    blurb: 'Takes the review off the tutor\u2019s profile and out of their rating.',
    sanction: null,
    /**
     * Only offered where there is something this can actually hide.
     *
     * A button that says "remove the content" and quietly removes nothing is
     * worse than no button: the admin believes they dealt with it.
     */
    onlyFor: 'review' as const,
  },
] as const;

export type ReportAction = (typeof REPORT_ACTIONS)[number]['id'];

/** Which actions make sense against this kind of target. */
export function actionsFor(targetType: string, hasSubject: boolean) {
  return REPORT_ACTIONS.filter((action) => {
    if ('onlyFor' in action && action.onlyFor !== targetType) return false;
    if (action.sanction && !hasSubject) return false;
    return true;
  });
}

export function findReportAction(id: string) {
  return REPORT_ACTIONS.find((action) => action.id === id);
}

/** How the queue describes each kind of thing somebody can report. */
export const REPORT_TARGET_LABELS: Record<string, string> = {
  user: 'Student',
  tutor_profile: 'Tutor',
  booking: 'Session',
  review: 'Review',
  message: 'Message',
};

/** The reasons a person picks from when reporting. Free text follows. */
export const REPORT_REASONS = [
  'Asked me to pay or message off Tutorly',
  'Rude, abusive or inappropriate',
  'Not who they say they are',
  'Did not teach what was booked',
  'Spam or advertising',
  'Something else',
] as const;
