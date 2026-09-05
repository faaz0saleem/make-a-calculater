/**
 * Notices about your account (SPEC.md §8).
 *
 * If we have told somebody off, this is where they read it in full, in the same
 * words the admin typed — not a summary, not a policy reference. And it is
 * where they answer back: every notice, including a warning, has an appeal box
 * under it, because a process without one is a process that only ever gets more
 * severe.
 *
 * What is deliberately absent: anything that stops them using the page, the
 * messages, or the sessions they already have.
 */

import Link from 'next/link';

import { acknowledgeNotice, appealNotice } from '@/app/settings/notices/actions';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { sanctionsFor } from '@/db/reports';
import { requireUser } from '@/lib/auth/guards';
import { isRestricted, RESTRICTED_PRIVILEGES, SANCTION_COPY } from '@/lib/moderation/sanctions';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notices' };

const DONE_COPY: Record<string, string> = {
  read: 'Thanks — that is marked as read.',
  appealed: 'Your appeal is with us. We will answer here.',
};

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const notices = await sanctionsFor(user.id);
  const restricted = isRestricted(notices);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Anything we have had to raise with you, in full, with what happens next.
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}
        {query.done && DONE_COPY[query.done] ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm">
            {DONE_COPY[query.done]}
          </p>
        ) : null}

        {restricted ? (
          <Card className="border-destructive" data-testid="restriction-banner">
            <CardHeader>
              <CardTitle as="h2">Limits on your account right now</CardTitle>
              <CardDescription>
                You are not receiving new trial requests and you are not boosted in search. Everything
                else — your students, your bookings, your messages, your money — is untouched.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Affected: {RESTRICTED_PRIVILEGES.join(', ').replace(/_/g, ' ')}.
            </CardContent>
          </Card>
        ) : null}

        {notices.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              Nothing here, which is the way it should be.
            </CardContent>
          </Card>
        ) : (
          notices.map((notice) => (
            <Card key={notice.id} data-testid="notice">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle as="h2">{SANCTION_COPY[notice.level].title}</CardTitle>
                  <Badge
                    variant={
                      notice.status === 'lifted'
                        ? 'success'
                        : notice.status === 'appealed'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {notice.status === 'lifted' ? 'Withdrawn' : notice.status}
                  </Badge>
                </div>
                <CardDescription>
                  {formatInTimeZone(notice.issuedAt, user.timezone, { dateStyle: 'long' })}
                  {notice.restrictedUntil
                    ? ` · until ${formatInTimeZone(notice.restrictedUntil, user.timezone, { dateStyle: 'long' })}`
                    : null}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <blockquote className="rounded-md bg-secondary px-3 py-2 text-sm">
                  {notice.reason}
                </blockquote>

                <p className="text-sm">{SANCTION_COPY[notice.level].consequence}</p>

                {notice.acknowledgedAt === null ? (
                  <form action={acknowledgeNotice}>
                    <input type="hidden" name="sanctionId" value={notice.id} />
                    <Button type="submit" className="min-h-11" data-testid="acknowledge-notice">
                      I have read this
                    </Button>
                  </form>
                ) : null}

                {notice.appealNote ? (
                  <div className="text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Your appeal
                    </p>
                    <p className="mt-1">{notice.appealNote}</p>

                    {notice.appealOutcome ? (
                      <>
                        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Our answer
                        </p>
                        <p className="mt-1" data-testid="appeal-outcome">
                          {notice.appealOutcome}
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Waiting for us. We will answer here.
                      </p>
                    )}
                  </div>
                ) : (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      Appeal this
                    </summary>
                    <form action={appealNotice} className="mt-2 flex flex-col gap-2">
                      <input type="hidden" name="sanctionId" value={notice.id} />
                      <label className="text-xs font-medium" htmlFor={`appeal-${notice.id}`}>
                        Tell us what we got wrong. A person reads it.
                      </label>
                      <Textarea id={`appeal-${notice.id}`} name="note" rows={4} required />
                      <Button type="submit" variant="outline" className="self-start" data-testid="send-appeal">
                        Send the appeal
                      </Button>
                    </form>
                  </details>
                )}
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
