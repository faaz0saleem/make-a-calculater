/**
 * A standing arrangement, from either side (SPEC.md §5).
 *
 * Shown to both the student and the tutor with the same shape and different
 * verbs, because it is the same object: the schedule, what is coming, and the
 * one control that ends it.
 *
 * The end control states its consequence before it happens — seven days, and
 * what survives that week — because ending somebody's weekly lesson is the kind
 * of thing a person should not do by accident.
 */

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { SeriesView } from '@/db/series';
import { formatCents } from '@/lib/money/cents';
import { describeSchedule } from '@/lib/series/occurrences';
import { END_NOTICE_DAYS } from '@/lib/series/rules';
import { formatInTimeZone } from '@/lib/time';

const OCCURRENCE_LABELS: Record<string, string> = {
  scheduled: 'Booked — credits taken 48h before',
  confirmed: 'Paid',
  in_progress: 'Happening now',
};

export function StandingSlots({
  series,
  viewer,
  timezone,
  endAction,
}: {
  series: readonly SeriesView[];
  viewer: 'student' | 'tutor';
  timezone: string;
  endAction: (seriesId: string, formData: FormData) => void | Promise<void>;
}) {
  if (series.length === 0) return null;

  return (
    <Card data-testid="standing-slots">
      <CardHeader>
        <CardTitle as="h2">Standing slots</CardTitle>
        <CardDescription>
          {viewer === 'student'
            ? 'Booked once, running every week. Nothing is paid up front — each session takes its credits 48 hours before.'
            : 'Reserved on your calendar. Nobody else can book these hours.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {series.map((row) => {
          const other = viewer === 'student' ? row.tutorName : row.studentName;

          return (
            <div key={row.id} className="flex flex-col gap-3" data-testid="standing-slot">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium">{other}</p>
                  <p className="text-sm text-muted-foreground">
                    {describeSchedule(row.weekdays, row.startTimeLocal, row.timezone)} ·{' '}
                    {row.durationMinutes} min · {formatCents(row.priceCents)} each
                  </p>
                </div>

                {row.status === 'ending' ? (
                  <Badge variant="destructive">Ends {row.endsOn}</Badge>
                ) : (
                  <Badge variant="success">Running</Badge>
                )}
              </div>

              {row.topics.length > 0 || row.topicNote ? (
                <div className="rounded-md bg-secondary px-3 py-2 text-xs" data-testid="series-topics">
                  {row.topics.length > 0 ? (
                    <p>
                      <span className="font-medium">Working through:</span>{' '}
                      {row.topics
                        .map((topic) =>
                          topic.reference ? `${topic.reference} ${topic.name}` : topic.name,
                        )
                        .join(' · ')}
                    </p>
                  ) : null}
                  {row.topicNote ? (
                    <p className={row.topics.length > 0 ? 'mt-1 text-muted-foreground' : ''}>
                      {viewer === 'tutor' ? `${other} said: ` : 'You said: '}
                      {row.topicNote}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {row.endReason ? (
                <p className="text-xs text-muted-foreground">
                  {row.endedBy === viewer ? 'You said' : `${other} said`}: {row.endReason}
                </p>
              ) : null}

              {row.upcoming.length > 0 ? (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {row.upcoming.slice(0, 6).map((occurrence) => (
                    <li
                      key={occurrence.bookingId}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                      data-testid="standing-occurrence"
                    >
                      <span>{formatInTimeZone(occurrence.startAtUtc, timezone)}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {OCCURRENCE_LABELS[occurrence.status] ?? occurrence.status}
                        </span>
                        <Link href={`/sessions/${occurrence.bookingId}`}>
                          <Button size="sm" variant="ghost">
                            Open
                          </Button>
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing left on the calendar for this one.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {viewer === 'student' ? (
                  <Link
                    href={`/progress/${row.tutorId}`}
                    className="text-sm underline underline-offset-4"
                  >
                    See your progress
                  </Link>
                ) : null}

                {row.status !== 'ending' ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      End this arrangement
                    </summary>
                    <form action={endAction.bind(null, row.id)} className="mt-2 flex flex-col gap-2">
                      <input type="hidden" name="as" value={viewer} />
                      <p className="text-xs text-muted-foreground">
                        It runs for another {END_NOTICE_DAYS} days, so nobody loses a session they
                        planned around. Everything after that is cancelled, and none of it has been
                        charged, so there is nothing to refund.
                      </p>
                      <label className="text-xs font-medium" htmlFor={`why-${row.id}`}>
                        Why. {other} reads this.
                      </label>
                      <Textarea id={`why-${row.id}`} name="reason" rows={2} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="destructive"
                        className="self-start"
                        data-testid="end-series"
                      >
                        End it in {END_NOTICE_DAYS} days
                      </Button>
                    </form>
                  </details>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
