/**
 * "How was it?" — the review prompt on a student's dashboard (SPEC.md §9).
 *
 * Only appears for a paid session that actually happened. It stays for the
 * seven days the review can be edited, then goes quiet: a prompt that never
 * disappears is one people learn to ignore.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReviewableSession } from '@/db/reviews';
import {
  MAX_REVIEW_CHARS,
  REVIEW_EDIT_WINDOW_DAYS,
  editWindowClosesAt,
  withinEditWindow,
} from '@/lib/reviews/rules';
import { formatInTimeZone } from '@/lib/time';

export function ReviewPrompt({
  sessions,
  timezone,
  now,
  action,
  error,
}: {
  sessions: ReviewableSession[];
  timezone: string;
  now: Date;
  action: (formData: FormData) => void | Promise<void>;
  error?: string | null;
}) {
  // Anything already reviewed and past its edit window is done with.
  const open = sessions.filter(
    (session) => !session.existing || withinEditWindow(session.existing.createdAt, now),
  );

  if (open.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>How was it?</CardTitle>
        <CardDescription>
          Reviews can only be left by someone who took the session, and can be changed for{' '}
          {REVIEW_EDIT_WINDOW_DAYS} days.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {open.map((session) => (
          <form
            key={session.bookingId}
            action={action}
            className="flex flex-col gap-3 border-t border-border pt-4 first:border-0 first:pt-0"
            data-testid="review-form"
          >
            <input type="hidden" name="bookingId" value={session.bookingId} />
            <input type="hidden" name="tutorId" value={session.tutorId} />

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="font-medium">{session.tutorName}</p>
              <span className="text-muted-foreground">
                {formatInTimeZone(session.startAtUtc, timezone, { dateStyle: 'medium' })}
              </span>
              {session.existing ? (
                <Badge variant="secondary">
                  editable until{' '}
                  {formatInTimeZone(editWindowClosesAt(session.existing.createdAt), timezone, {
                    dateStyle: 'medium',
                  })}
                </Badge>
              ) : null}
            </div>

            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="sr-only">Rating for {session.tutorName}</legend>
              {[1, 2, 3, 4, 5].map((star) => (
                <label key={star} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name="rating"
                    value={star}
                    required
                    defaultChecked={session.existing?.rating === star}
                    className="size-4"
                  />
                  {star}★
                </label>
              ))}
            </fieldset>

            <label className="sr-only" htmlFor={`body-${session.bookingId}`}>
              What went well, or did not
            </label>
            <textarea
              id={`body-${session.bookingId}`}
              name="body"
              rows={2}
              maxLength={MAX_REVIEW_CHARS}
              defaultValue={session.existing?.body ?? ''}
              placeholder="Optional. What went well, or did not."
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            <Button type="submit" size="sm" className="min-h-11 self-start">
              {session.existing ? 'Update review' : 'Post review'}
            </Button>
          </form>
        ))}
      </CardContent>
    </Card>
  );
}
