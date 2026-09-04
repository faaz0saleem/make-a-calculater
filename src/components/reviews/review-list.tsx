/**
 * Reviews on a tutor's profile (SPEC.md §9).
 *
 * The headline number is the Bayesian average, which is what the ranking uses
 * too — one 5★ review does not put a new tutor above someone with two hundred.
 * The breakdown bar next to it is the raw distribution, so the honest shape of
 * the ratings is still visible rather than hidden behind the adjusted number.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReviewRow } from '@/db/reviews';
import { formatStars, type RatingSummary } from '@/lib/reviews/rules';
import { formatInTimeZone } from '@/lib/time';

const STARS = [5, 4, 3, 2, 1] as const;

export function Stars({ rating }: { rating: number }) {
  // `role="img"` is what makes the label legal on a span — without a role, a
  // screen reader is required to ignore `aria-label` entirely, so the rating
  // would be five unlabelled glyphs.
  return (
    <span role="img" aria-label={`${rating} out of 5 stars`} className="tracking-tight text-[var(--warning)]">
      <span aria-hidden>{'★'.repeat(rating)}</span>
      <span aria-hidden className="text-muted-foreground">
        {'★'.repeat(5 - rating)}
      </span>
    </span>
  );
}

export function ReviewList({
  summary,
  reviews,
  timezone,
}: {
  summary: RatingSummary;
  reviews: ReviewRow[];
  timezone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reviews</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-6">
          <div>
            <p className="text-3xl font-semibold tabular-nums">{formatStars(summary.displayedMilli)}</p>
            <p className="text-sm text-muted-foreground">
              {summary.count === 0
                ? 'No reviews yet'
                : `${summary.count} review${summary.count === 1 ? '' : 's'}`}
            </p>
          </div>

          <ul className="min-w-48 flex-1 flex-col gap-1">
            {STARS.map((star) => (
              <li key={star} className="flex items-center gap-2 text-xs">
                <span className="w-6 tabular-nums text-muted-foreground">{star}★</span>
                <span
                  className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
                  role="img"
                  aria-label={`${star} stars: ${summary.distribution[star]} of ${summary.count}`}
                >
                  <span
                    className="block h-full rounded-full bg-[var(--success)]"
                    style={{ width: `${summary.sharePercent[star]}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums text-muted-foreground">
                  {summary.distribution[star]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {summary.count === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has reviewed this tutor yet. Reviews can only be left by a student who took a paid
            session, so there are never any bought ones.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {reviews.map((review) => (
              <li key={review.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Stars rating={review.rating} />
                  <span className="font-medium">{review.studentName}</span>
                  <span className="text-muted-foreground">
                    {formatInTimeZone(review.createdAt, timezone, { dateStyle: 'medium' })}
                  </span>
                </div>

                {review.body ? <p className="whitespace-pre-wrap text-sm">{review.body}</p> : null}

                {review.tutorReply ? (
                  <div className="mt-1 rounded-md bg-secondary px-3 py-2 text-sm">
                    <p className="font-medium">Reply from the tutor</p>
                    <p className="whitespace-pre-wrap">{review.tutorReply}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
