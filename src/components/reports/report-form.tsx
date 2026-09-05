/**
 * Reporting something (SPEC.md §10).
 *
 * Folded away behind a summary rather than sitting on the page as a button:
 * reporting somebody should be findable, not suggested. The reasons are a fixed
 * list plus free text, because "tell us in your own words" alone produces
 * reports nobody can triage and a dropdown alone produces reports nobody can
 * act on.
 *
 * A server component — there is no state here, only a form.
 */

import { fileReportAction } from '@/app/report/actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { REPORT_REASONS } from '@/lib/moderation/reports';

export function ReportForm({
  targetType,
  targetId,
  returnTo,
  label,
  summary = 'Report this',
}: {
  targetType: 'user' | 'tutor_profile' | 'booking' | 'review' | 'message';
  targetId: string;
  returnTo: string;
  /** What is being reported, so somebody knows what they are about to do. */
  label: string;
  summary?: string;
}) {
  const id = `report-${targetType}-${targetId}`;

  return (
    <details className="text-sm" data-testid="report-form">
      <summary className="cursor-pointer text-muted-foreground underline underline-offset-4">
        {summary}
      </summary>

      <form action={fileReportAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <p className="text-xs text-muted-foreground">
          You are reporting <strong>{label}</strong>. A person reads every report. Nothing happens to
          them automatically, and we do not tell them who reported it.
        </p>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium">What happened?</legend>
          {REPORT_REASONS.map((reason) => (
            <label key={reason} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="reason"
                value={reason}
                required
                className="mt-1 h-4 w-4 accent-[var(--primary)]"
              />
              <span>{reason}</span>
            </label>
          ))}
        </fieldset>

        <label className="text-xs font-medium" htmlFor={id}>
          Anything else we should know
        </label>
        <Textarea id={id} name="body" rows={3} />

        <Button type="submit" variant="outline" className="self-start" data-testid="send-report">
          Send the report
        </Button>
      </form>
    </details>
  );
}
