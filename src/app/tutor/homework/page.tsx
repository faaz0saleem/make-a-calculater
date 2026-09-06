/**
 * Work a tutor has set, and what has come back (SPEC.md §9).
 *
 * Ordered by who is waiting: handed in and unmarked first, then set and not yet
 * done, then everything finished. A tutor opening this wants to know what is
 * sitting on *their* desk.
 */

import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { homeworkForTutor } from '@/db/homework';
import { requireRole } from '@/lib/auth/guards';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Work you have set' };

export default async function TutorHomeworkPage() {
  const tutor = await requireRole('tutor');
  const items = await homeworkForTutor(tutor.id);

  const toMark = items.filter((item) => item.status === 'submitted');
  const waiting = items.filter((item) => item.status === 'assigned');
  const done = items.filter((item) => item.status === 'marked');

  const sections = [
    { key: 'mark', title: 'Waiting on you', blurb: 'Handed in and not marked yet.', rows: toMark },
    { key: 'set', title: 'Waiting on them', blurb: 'Set, not handed in.', rows: waiting },
    { key: 'done', title: 'Marked', blurb: '', rows: done },
  ];

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Work you have set</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {toMark.length === 0 ? 'Nothing waiting on you.' : `${toMark.length} to mark.`}
            </p>
          </div>
          <Link href="/tutor" className="text-sm text-muted-foreground underline underline-offset-4">
            Back to teaching
          </Link>
        </div>

        {items.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              Nothing yet. After a session, the page for it has a box for setting work — it is the
              part of a tutoring relationship that only exists here.
            </CardContent>
          </Card>
        ) : null}

        {sections
          .filter((section) => section.rows.length > 0)
          .map((section) => (
            <Card key={section.key}>
              <CardHeader>
                <CardTitle as="h2">{section.title}</CardTitle>
                {section.blurb ? <CardDescription>{section.blurb}</CardDescription> : null}
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {section.rows.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-3"
                      data-testid="tutor-homework-row"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.otherName}
                          {item.topicName ? ` · ${item.topicName}` : ''}
                          {item.dueAt
                            ? ` · due ${formatInTimeZone(item.dueAt, tutor.timezone, { dateStyle: 'medium' })}`
                            : ''}
                        </p>
                      </div>

                      <span className="flex items-center gap-2">
                        {item.mark !== null ? (
                          <span className="tabular-nums text-xs">
                            {item.mark}/{item.markOutOf}
                          </span>
                        ) : null}
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
                        <Link href={`/tutor/sessions/${item.bookingId}`}>
                          <Button size="sm" variant="outline">
                            Open
                          </Button>
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
      </main>
    </>
  );
}
