/**
 * A tutor's own view of their reviews (SPEC.md §9).
 *
 * One public reply per review, and no way to delete or edit what a student
 * wrote — a tutor who could would make the whole rating meaningless. The reply
 * box is the only control here.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Stars } from '@/components/reviews/review-list';
import type { ReviewRow } from '@/db/reviews';
import { MAX_REPLY_CHARS, formatStars, type RatingSummary } from '@/lib/reviews/rules';
import { formatInTimeZone } from '@/lib/time';

export function TutorReviews({
  summary,
  reviews,
  timezone,
  action,
}: {
  summary: RatingSummary;
  reviews: ReviewRow[];
  timezone: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your reviews</CardTitle>
        <CardDescription>
          {summary.count === 0
            ? 'No reviews yet. They can only come from a student who took a paid session with you.'
            : `${formatStars(summary.displayedMilli)} shown publicly, from ${summary.count} review${summary.count === 1 ? '' : 's'}.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The number students see is weighted, so a single early review cannot swing it far in either
            direction.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {reviews.map((review) => (
              <li key={review.id} className="flex flex-col gap-2 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars rating={review.rating} />
                  <span className="font-medium">{review.studentName}</span>
                  <span className="text-muted-foreground">
                    {formatInTimeZone(review.createdAt, timezone, { dateStyle: 'medium' })}
                  </span>
                </div>

                {review.body ? <p className="whitespace-pre-wrap">{review.body}</p> : null}

                {review.tutorReply ? (
                  <div className="rounded-md bg-secondary px-3 py-2">
                    <p className="flex items-center gap-2 font-medium">
                      Your reply <Badge variant="outline">public</Badge>
                    </p>
                    <p className="whitespace-pre-wrap">{review.tutorReply}</p>
                  </div>
                ) : (
                  <form action={action} className="flex flex-col gap-2">
                    <input type="hidden" name="reviewId" value={review.id} />
                    <label className="sr-only" htmlFor={`reply-${review.id}`}>
                      Reply to {review.studentName}
                    </label>
                    <textarea
                      id={`reply-${review.id}`}
                      name="reply"
                      rows={2}
                      maxLength={MAX_REPLY_CHARS}
                      placeholder="Reply once, publicly. You cannot edit it afterwards."
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button type="submit" size="sm" variant="outline" className="min-h-11 self-start">
                      Post reply
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
