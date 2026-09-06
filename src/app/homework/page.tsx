/**
 * Work between sessions, from the student's side (SPEC.md §9).
 *
 * Ordered by what is waiting on somebody rather than by date: work still to
 * hand in comes first, then work waiting on the tutor, then everything marked.
 * A list ordered purely by date buries the one thing due tomorrow under six
 * things already done.
 */

import Link from 'next/link';

import { handInHomework } from '@/app/homework/actions';
import { HomeworkUpload } from '@/components/homework/upload';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { homeworkForStudent } from '@/db/homework';
import { requireUser } from '@/lib/auth/guards';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your work' };

export default async function HomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [user, query] = await Promise.all([requireUser(), searchParams]);
  const items = await homeworkForStudent(user.id);

  const waiting = items.filter((item) => item.status === 'assigned').length;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your work</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {waiting === 0
              ? 'Nothing waiting on you.'
              : `${waiting} still to hand in.`}
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}
        {query.saved ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm" data-testid="handed-in">
            Handed in. Your tutor has been told.
          </p>
        ) : null}

        {items.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              Nothing yet. Your tutor can set work after a session, and it will appear here with the
              chapter it belongs to.
            </CardContent>
          </Card>
        ) : (
          items.map((item) => (
            <Card key={item.id} data-testid="homework-card">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle as="h2">{item.title}</CardTitle>
                  <Badge
                    variant={
                      item.status === 'marked'
                        ? 'success'
                        : item.status === 'submitted'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {item.status === 'assigned'
                      ? 'To do'
                      : item.status === 'submitted'
                        ? 'With your tutor'
                        : 'Marked'}
                  </Badge>
                </div>
                <CardDescription>
                  {item.otherName ? `Set by ${item.otherName}` : 'Set by your tutor'}
                  {item.topicName ? ` · ${item.topicName}` : ''}
                  {item.dueAt
                    ? ` · due ${formatInTimeZone(item.dueAt, user.timezone, { dateStyle: 'medium' })}`
                    : ''}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                {item.body ? <p className="whitespace-pre-wrap text-sm">{item.body}</p> : null}

                {item.attachments.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-sm">
                    {item.attachments.map((file) => (
                      <li key={file.url}>
                        <a
                          href={file.url}
                          className="underline underline-offset-4"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {file.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {item.markedAt ? (
                  <div className="rounded-md bg-secondary px-3 py-2 text-sm" data-testid="homework-feedback">
                    {item.mark !== null ? (
                      <p className="font-medium">
                        {item.mark} out of {item.markOutOf}
                      </p>
                    ) : null}
                    <p className="mt-1 whitespace-pre-wrap">{item.feedback}</p>
                  </div>
                ) : null}

                {item.submittedAt ? (
                  <div className="text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      You handed in{' '}
                      {formatInTimeZone(item.submittedAt, user.timezone, { dateStyle: 'medium' })}
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
                ) : null}

                {item.status !== 'marked' ? (
                  <HomeworkUpload
                    homeworkId={item.id}
                    action={handInHomework.bind(null, item.id)}
                    hasSubmission={item.submittedAt !== null}
                  />
                ) : null}
              </CardContent>
            </Card>
          ))
        )}

        <Link href="/dashboard" className="text-sm text-muted-foreground underline underline-offset-4">
          Back
        </Link>
      </main>
    </>
  );
}
