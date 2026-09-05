/**
 * The conversation list (SPEC.md §8).
 *
 * Threads only exist where there is a booking or a trial request, so this list
 * is short by construction — and there is nothing here that lets you start a
 * conversation with a stranger.
 */

import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listThreadsFor } from '@/db/messages';
import { requireUser } from '@/lib/auth/guards';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Messages' };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [user, query] = await Promise.all([requireUser(), searchParams]);
  const threads = await listThreadsFor(user.id);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
          <p className="text-sm text-muted-foreground">
            A conversation opens when you book, or ask for a trial. Nobody can message you out of the blue.
          </p>
        </div>

        {query.error === 'no-booking' ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            You can only message someone you have a booking or a trial request with.
          </p>
        ) : null}

        {threads.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No conversations yet</CardTitle>
              <CardDescription>
                Book a session or ask a tutor for a free trial, and the conversation opens itself.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/" className="text-sm underline underline-offset-4">
                Find a tutor
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/messages/${thread.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="thread-link"
                >
                  {thread.otherAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thread.otherAvatarUrl}
                      alt=""
                      className="size-10 shrink-0 rounded-full border border-border object-cover"
                    />
                  ) : (
                    <span className="size-10 shrink-0 rounded-full bg-secondary" aria-hidden />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{thread.otherName}</span>
                      {thread.unread > 0 ? <Badge variant="default">{thread.unread}</Badge> : null}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {thread.lastMessage ?? 'No messages yet'}
                    </span>
                  </span>

                  {thread.lastMessageAt ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatInTimeZone(thread.lastMessageAt, user.timezone, { dateStyle: 'medium' })}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
