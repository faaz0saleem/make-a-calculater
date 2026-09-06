/**
 * After a session (SPEC.md §4, §9).
 *
 * Two things a tutor does once a lesson is over, on one page because they are
 * one thought: say what was actually covered, and set the work that follows
 * from it.
 *
 * The coverage half is deliberately not pre-ticked. A session booked for three
 * chapters that got through one is the normal case, and a form that defaulted
 * everything to "covered" would collect a lie in one click and make the
 * student's progress view worthless — which is the one thing on this platform
 * that gives them a reason to book the fifteenth lesson.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  markSubmission,
  recordCoverage,
  setHomework,
} from '@/app/tutor/sessions/[bookingId]/actions';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db/client';
import { homeworkForBooking } from '@/db/homework';
import { bookings, users } from '@/db/schema';
import { topicsOnBooking } from '@/db/topics';
import { requireRole } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { formatInTimeZone } from '@/lib/time';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'After the session' };

const SAVED: Record<string, string> = {
  coverage: 'Saved. Your student can see it on their progress page.',
  homework: 'Set. They have been told.',
  marked: 'Marked. They have been told.',
};

const GRASP_LABELS = [
  { value: '', label: 'Not sure' },
  { value: 'struggling', label: 'Struggling' },
  { value: 'developing', label: 'Developing' },
  { value: 'secure', label: 'Secure' },
] as const;

export default async function AfterSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [{ bookingId }, query, tutor] = await Promise.all([
    params,
    searchParams,
    requireRole('tutor'),
  ]);

  const [booking] = await db
    .select({
      id: bookings.id,
      startAtUtc: bookings.startAtUtc,
      durationMinutes: bookings.durationMinutes,
      status: bookings.status,
      isTrial: bookings.isTrial,
      priceCents: bookings.priceCents,
      completedAt: bookings.completedAt,
      topicNote: bookings.topicNote,
      studentId: bookings.studentId,
      studentName: users.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.studentId))
    // Scoped to this tutor in the query, not by a check afterwards.
    .where(and(eq(bookings.id, bookingId), eq(bookings.tutorId, tutor.id)))
    .limit(1);

  if (!booking) notFound();

  const [topics, work] = await Promise.all([
    topicsOnBooking(bookingId),
    homeworkForBooking(bookingId),
  ]);

  const happened = booking.completedAt !== null;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {booking.studentName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatInTimeZone(booking.startAtUtc, tutor.timezone, { dateStyle: 'full', timeStyle: 'short' })}{' '}
            · {booking.durationMinutes} min ·{' '}
            {booking.isTrial ? 'Free trial' : formatCents(booking.priceCents)}
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}
        {query.saved && SAVED[query.saved] ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm" data-testid="after-saved">
            {SAVED[query.saved]}
          </p>
        ) : null}

        {booking.topicNote ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2">What they asked for</CardTitle>
            </CardHeader>
            <CardContent>
              <blockquote className="rounded-md bg-secondary px-3 py-2 text-sm" data-testid="student-note">
                {booking.topicNote}
              </blockquote>
            </CardContent>
          </Card>
        ) : null}

        {/* ------------------------------------------------------------- */}
        {/* What was covered                                               */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">What you covered</CardTitle>
            <CardDescription>
              Only what you actually got through. A session booked for three chapters that got
              through one is a normal session — and their progress page is only worth anything if it
              is true.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {topics.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No chapters were attached to this booking.
              </p>
            ) : !happened ? (
              <p className="text-sm text-muted-foreground">
                You can record this once the session has happened.
              </p>
            ) : (
              <form action={recordCoverage.bind(null, bookingId)} className="flex flex-col gap-4">
                <ul className="flex flex-col divide-y divide-border">
                  {topics.map((topic) => (
                    <li
                      key={topic.topicId}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                      data-testid="coverage-row"
                    >
                      <input type="hidden" name="topicId" value={topic.topicId} />

                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name={`covered:${topic.topicId}`}
                          defaultChecked={topic.covered === true}
                          className="mt-1 h-4 w-4 accent-[var(--primary)]"
                          data-testid="covered-box"
                        />
                        <span>
                          {topic.reference ? (
                            <span className="text-muted-foreground">{topic.reference} </span>
                          ) : null}
                          {topic.name}
                        </span>
                      </label>

                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        How are they doing?
                        <select
                          name={`grasp:${topic.topicId}`}
                          defaultValue={topic.grasp ?? ''}
                          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {GRASP_LABELS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  ))}
                </ul>

                <Button type="submit" className="self-start min-h-11" data-testid="save-coverage">
                  Save what you covered
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* Homework                                                       */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Set some work</CardTitle>
            <CardDescription>
              It lives here, with the chapter it belongs to. This is the part of a tutoring
              relationship that only exists on the platform.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-5">
            {work.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {work.map((item) => (
                  <li key={item.id} className="flex flex-col gap-2 py-3" data-testid="homework-item">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{item.title}</span>
                      <Badge
                        variant={
                          item.status === 'marked'
                            ? 'success'
                            : item.status === 'submitted'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {item.status}
                      </Badge>
                    </div>

                    {item.topicName ? (
                      <p className="text-xs text-muted-foreground">{item.topicName}</p>
                    ) : null}
                    {item.body ? <p className="text-sm">{item.body}</p> : null}

                    {item.submittedAt ? (
                      <div className="rounded-md bg-secondary px-3 py-2 text-sm">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Handed in{' '}
                          {formatInTimeZone(item.submittedAt, tutor.timezone, { dateStyle: 'medium' })}
                        </p>
                        {item.submissionBody ? (
                          <p className="mt-1 whitespace-pre-wrap">{item.submissionBody}</p>
                        ) : null}
                        {item.submissionAttachments.map((file) => (
                          <a
                            key={file.url}
                            href={file.url}
                            className="mt-1 block underline underline-offset-4"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {file.name}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not handed in yet.</p>
                    )}

                    {item.markedAt ? (
                      <p className="text-sm" data-testid="homework-mark">
                        {item.mark !== null ? (
                          <strong className="font-medium">
                            {item.mark} / {item.markOutOf}.{' '}
                          </strong>
                        ) : null}
                        {item.feedback}
                      </p>
                    ) : item.submittedAt ? (
                      <form
                        action={markSubmission.bind(null, bookingId, item.id)}
                        className="flex flex-col gap-2"
                      >
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium" htmlFor={`mark-${item.id}`}>
                              Mark (optional)
                            </label>
                            <Input
                              id={`mark-${item.id}`}
                              name="mark"
                              type="number"
                              min={0}
                              className="h-9 w-24"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium" htmlFor={`out-of-${item.id}`}>
                              Out of
                            </label>
                            <Input
                              id={`out-of-${item.id}`}
                              name="markOutOf"
                              type="number"
                              min={1}
                              className="h-9 w-24"
                            />
                          </div>
                        </div>

                        <label className="text-xs font-medium" htmlFor={`feedback-${item.id}`}>
                          What they should do differently. Required — a bare mark teaches nothing.
                        </label>
                        <Textarea id={`feedback-${item.id}`} name="feedback" rows={3} required />

                        <Button type="submit" size="sm" className="self-start" data-testid="mark-homework">
                          Mark it
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <form action={setHomework.bind(null, bookingId)} className="flex flex-col gap-3">
              <Field label="What should they do?" htmlFor="title">
                <Input
                  id="title"
                  name="title"
                  required
                  maxLength={200}
                  placeholder="Past paper 2019, questions 4 to 9"
                  data-testid="homework-title"
                />
              </Field>

              <Field label="Anything more" htmlFor="body" hint="Optional.">
                <Textarea id="body" name="body" rows={3} maxLength={8000} />
              </Field>

              <div className="flex flex-wrap gap-3">
                {topics.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium" htmlFor="topicId">
                      Which chapter
                    </label>
                    <select
                      id="topicId"
                      name="topicId"
                      className="h-10 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Not chapter-specific</option>
                      {topics.map((topic) => (
                        <option key={topic.topicId} value={topic.topicId}>
                          {topic.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium" htmlFor="dueAt">
                    Due by
                  </label>
                  <Input id="dueAt" name="dueAt" type="date" className="h-10" />
                </div>
              </div>

              <Button type="submit" className="self-start min-h-11" data-testid="assign-homework">
                Set it
              </Button>
            </form>
          </CardContent>
        </Card>

        <Link href="/tutor" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to teaching
        </Link>
      </main>
    </>
  );
}
