/**
 * One conversation (SPEC.md §8).
 *
 * The bodies rendered here are the masked ones — `loadThreadForViewer` cannot
 * return anything else. Someone who is not in the thread gets a 404 rather than
 * a 403, so the URL cannot be used to find out that two people are talking.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { postMessage } from '@/app/messages/actions';
import { Composer } from '@/components/messaging/composer';
import { ReportForm } from '@/components/reports/report-form';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { loadThreadForViewer, markThreadRead } from '@/db/messages';
import { requireUser } from '@/lib/auth/guards';
import { MASKING_NOTICE } from '@/lib/messaging/masking';
import { formatInTimeZone } from '@/lib/time';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Conversation' };

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ error?: string; reported?: string }>;
}) {
  const [{ threadId }, query, user] = await Promise.all([params, searchParams, requireUser()]);

  const thread = await loadThreadForViewer(threadId, user.id);
  if (!thread) notFound();

  // Opening the conversation is what marks it read. Called directly rather than
  // through the Server Action, because an action revalidates and nothing may
  // revalidate during a render.
  await markThreadRead(threadId, user.id);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{thread.otherName}</h1>
            <p className="text-sm text-muted-foreground">
              {thread.viewerIsTutor ? 'Your student' : 'Your tutor'} ·{' '}
              <Link href={`/tutors/${thread.tutorId}`} className="underline underline-offset-4">
                {thread.viewerIsTutor ? 'Your profile' : 'View profile'}
              </Link>
            </p>
          </div>
          <Link href="/messages" className="text-sm text-muted-foreground underline underline-offset-4">
            All conversations
          </Link>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {query.reported ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm" data-testid="reported">
            Thanks. Somebody will read it. We have not told them you reported it.
          </p>
        ) : null}

        {thread.messages.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No messages yet. Say hello — or send over what you would like to work on.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {thread.messages.map((message) => {
              const mine = message.senderId === user.id;

              return (
                <li
                  key={message.id}
                  className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}
                  data-testid="message"
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                      mine ? 'bg-primary text-primary-foreground' : 'bg-secondary',
                    )}
                  >
                    {message.body ? <p className="whitespace-pre-wrap">{message.body}</p> : null}

                    {message.attachments.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-1">
                        {message.attachments.map((file) => (
                          <li key={file.url}>
                            <a
                              href={file.url}
                              className="underline underline-offset-4"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {file.name}
                            </a>{' '}
                            <span className="opacity-70">
                              {Math.max(1, Math.round(file.bytes / 1024))} KB
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatInTimeZone(message.createdAt, user.timezone)}</span>
                    {message.redactions > 0 ? (
                      <Badge variant="outline" title={MASKING_NOTICE}>
                        contact details hidden
                      </Badge>
                    ) : null}
                    {!mine ? (
                      <ReportForm
                        targetType="message"
                        targetId={message.id}
                        returnTo={`/messages/${thread.id}`}
                        label={`this message from ${thread.otherName}`}
                        summary="Report"
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <Composer threadId={thread.id} action={postMessage} />

        <ReportForm
          targetType={thread.viewerIsTutor ? 'user' : 'tutor_profile'}
          targetId={thread.otherId}
          returnTo={`/messages/${thread.id}`}
          label={thread.otherName}
          summary={`Report ${thread.otherName}`}
        />
      </main>
    </>
  );
}
