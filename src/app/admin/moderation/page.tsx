/**
 * Moderation: flagged messages and reviews (SPEC.md §9, §10).
 *
 * The messages queue is ordered by how many pieces of contact information the
 * masker took out — a message with three redactions in it is somebody trying
 * hard to take the lesson off-platform, and is worth a human's attention before
 * a message with one.
 *
 * This is the only screen in the product that shows what was actually typed.
 * `flaggedMessages` demands an admin itself, so the check is not something a
 * future route can forget.
 */

import Link from 'next/link';

import {
  hideReviewAction,
  resolveDisputeAction,
  unhideReviewAction,
} from '@/app/admin/moderation/actions';
import { SiteHeader } from '@/components/site-header';
import { Stars } from '@/components/reviews/review-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db/client';
import { openDisputes } from '@/db/disputes';
import { flaggedMessages } from '@/db/moderation';
import { reviews, users } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { desc, eq } from 'drizzle-orm';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Moderation' };

export default async function ModerationPage() {
  const admin = await requireRole('admin');

  const [disputes, flagged, recentReviews] = await Promise.all([
    openDisputes(),
    flaggedMessages(admin),
    db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        body: reviews.body,
        tutorId: reviews.tutorId,
        studentName: users.name,
        hiddenAt: reviews.hiddenAt,
        hiddenReason: reviews.hiddenReason,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.studentId))
      .orderBy(desc(reviews.createdAt))
      .limit(25),
  ]);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Moderation</h1>
          <p className="text-sm text-muted-foreground">
            Everything on this page is logged. Hiding a review writes an audit row with your reason.
          </p>
        </div>

        <Card className={disputes.length > 0 ? 'border-destructive' : undefined}>
          <CardHeader>
            <CardTitle>Disputed sessions</CardTitle>
            <CardDescription>
              {disputes.length === 0
                ? 'Nothing waiting.'
                : `${disputes.length} waiting. Money on these sessions is frozen until you decide — settlement skips them entirely.`}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {disputes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Either side can report a problem during the 24 hours after a session. Nothing pays out or
                refunds while a report is open.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {disputes.map((dispute) => (
                  <li key={dispute.reportId} className="flex flex-col gap-2 py-3 text-sm" data-testid="dispute">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{dispute.reason}</span>
                      <Badge variant="secondary">
                        reported by {dispute.reporterName}
                      </Badge>
                      <span className="text-muted-foreground">
                        {dispute.studentName} with {dispute.tutorName} ·{' '}
                        {formatInTimeZone(dispute.startAtUtc, admin.timezone)} ·{' '}
                        {formatCents(dispute.priceCents)}
                      </span>
                    </div>

                    {dispute.body ? (
                      <p className="whitespace-pre-wrap text-muted-foreground">{dispute.body}</p>
                    ) : null}

                    <form action={resolveDisputeAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="reportId" value={dispute.reportId} />
                      <label className="flex-1">
                        <span className="sr-only">Your reason</span>
                        <input
                          name="reason"
                          required
                          placeholder="What did you decide, and why?"
                          className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </label>
                      <Button
                        type="submit"
                        name="decision"
                        value="refund"
                        size="sm"
                        variant="destructive"
                        className="min-h-11"
                        data-testid="dispute-refund"
                      >
                        Refund the student
                      </Button>
                      <Button
                        type="submit"
                        name="decision"
                        value="settle"
                        size="sm"
                        variant="outline"
                        className="min-h-11"
                        data-testid="dispute-settle"
                      >
                        Settle as it stands
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Flagged messages</CardTitle>
            <CardDescription>
              {flagged.length === 0
                ? 'Nothing has been redacted yet.'
                : `${flagged.length} message${flagged.length === 1 ? '' : 's'} had contact details taken out. The raw text is shown only here.`}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {flagged.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Messages are masked on write; anything the masker touches shows up here.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {flagged.map((message) => (
                  <li key={message.id} className="flex flex-col gap-2 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{message.senderName}</span>
                      <Badge variant={message.redactions > 1 ? 'destructive' : 'secondary'}>
                        {message.redactions} redaction{message.redactions === 1 ? '' : 's'}
                      </Badge>
                      <span className="text-muted-foreground">
                        {formatInTimeZone(message.createdAt, admin.timezone)}
                      </span>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">What both of them see</p>
                        <p className="whitespace-pre-wrap rounded-md bg-secondary px-3 py-2">
                          {message.masked}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">What was typed</p>
                        <p className="whitespace-pre-wrap rounded-md bg-destructive/10 px-3 py-2">
                          {message.raw}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent reviews</CardTitle>
            <CardDescription>
              Hiding one removes it from the tutor&rsquo;s profile and from the rating it contributed to.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {recentReviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {recentReviews.map((review) => (
                  <li key={review.id} className="flex flex-col gap-2 py-3 text-sm" data-testid="admin-review">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars rating={review.rating} />
                      <span className="font-medium">{review.studentName}</span>
                      <Link
                        href={`/tutors/${review.tutorId}`}
                        className="text-muted-foreground underline underline-offset-4"
                      >
                        tutor profile
                      </Link>
                      {review.hiddenAt ? <Badge variant="destructive">hidden</Badge> : null}
                    </div>

                    {review.body ? <p className="whitespace-pre-wrap">{review.body}</p> : null}

                    {review.hiddenAt ? (
                      <form action={unhideReviewAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="reviewId" value={review.id} />
                        <p className="text-xs text-muted-foreground">Hidden: {review.hiddenReason}</p>
                        <Button type="submit" size="sm" variant="outline" className="min-h-11">
                          Restore
                        </Button>
                      </form>
                    ) : (
                      <form action={hideReviewAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="reviewId" value={review.id} />
                        <label className="flex-1">
                          <span className="sr-only">Reason for hiding</span>
                          <input
                            name="reason"
                            required
                            placeholder="Why is this being hidden?"
                            className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </label>
                        <Button type="submit" size="sm" variant="destructive" className="min-h-11">
                          Hide
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
