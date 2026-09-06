/**
 * Recruiting the first cohort (SPEC.md §3, §14).
 *
 * Nobody finds a marketplace's signup page on day one — the first ten tutors
 * are people somebody spoke to. This turns that conversation into a link they
 * can open, which already knows their name and does not ask them to photograph
 * a degree certificate for a review queue of one.
 *
 * The link is shown exactly once, on the screen that creates it. It is stored
 * hashed, so it cannot be recovered from here or from a database dump — if it
 * is lost, the honest answer is to make another one.
 */

import Link from 'next/link';

import { inviteTutorAction, revokeInviteAction } from '@/app/admin/invite/actions';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { emailOrigin } from '@/db/email';
import { INVITE_TTL_DAYS, recentInvites } from '@/db/invites';
import { requireRole } from '@/lib/auth/guards';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invite a tutor' };

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; token?: string; error?: string; done?: string }>;
}) {
  const [admin, query] = await Promise.all([requireRole('admin'), searchParams]);
  const invites = await recentInvites(25);

  const link = query.token ? `${emailOrigin()}/invite/${query.token}` : null;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invite a tutor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            For somebody you have already spoken to. They skip the document queue and go straight to
            filling in what they teach.
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {query.done === 'revoked' ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm">
            Withdrawn. That link no longer works.
          </p>
        ) : null}

        {link ? (
          <Card data-testid="invite-created">
            <CardHeader>
              <CardTitle as="h2">Send them this link</CardTitle>
              <CardDescription>
                It works once and expires in {INVITE_TTL_DAYS} days. We do not keep a copy you can
                come back for — if it goes missing, make another.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <code
                className="block overflow-x-auto rounded-md bg-secondary px-3 py-2 font-mono text-sm"
                data-testid="invite-link"
              >
                {link}
              </code>
              <p className="text-xs text-muted-foreground">
                Send it however you actually reached them. Most of the first cohort will read it on
                WhatsApp.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">Who are you inviting?</CardTitle>
            <CardDescription>
              Their email is how they will sign in. The note is for you — it goes in the audit trail
              beside your name.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form action={inviteTutorAction} className="flex flex-col gap-4">
              <Field label="Email" htmlFor="email">
                <Input id="email" name="email" type="email" required autoComplete="off" />
              </Field>

              <Field label="Their name" htmlFor="name" hint="Optional. It prefills their profile.">
                <Input id="name" name="name" autoComplete="off" />
              </Field>

              <Field
                label="Why them"
                htmlFor="note"
                hint="Optional, and only you see it. Where you met, what they teach, who vouched."
              >
                <Textarea id="note" name="note" rows={2} maxLength={400} />
              </Field>

              <div className="rounded-md bg-secondary px-4 py-3 text-sm">
                <p className="font-medium">What this does</p>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                  <li>Creates their account when they open the link and set a password.</li>
                  <li>
                    Marks their credentials as reviewed by you — they never enter the verification
                    queue.
                  </li>
                  <li>
                    Still asks them for subjects, rates and hours. Nobody else can answer those, and
                    a profile without them is an empty card in the feed.
                  </li>
                </ul>
              </div>

              <Button type="submit" className="self-start" data-testid="create-invite">
                Create the link
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Invitations</CardTitle>
            <CardDescription>{invites.length} in the last while.</CardDescription>
          </CardHeader>

          <CardContent>
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody invited yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {invites.map((invite) => {
                  const expired = !invite.acceptedAt && invite.expiresAt <= new Date();

                  return (
                    <li key={invite.id} className="flex flex-col gap-2 py-3" data-testid="invite-row">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{invite.name ?? invite.email}</span>
                        {invite.acceptedAt ? (
                          <Badge variant="success">Joined</Badge>
                        ) : expired ? (
                          <Badge variant="secondary">Expired</Badge>
                        ) : (
                          <Badge variant="secondary">Waiting</Badge>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {invite.email} · invited by {invite.invitedByName ?? 'an admin'} on{' '}
                        {formatInTimeZone(invite.createdAt, admin.timezone)}
                        {invite.acceptedAt
                          ? ` · joined ${formatInTimeZone(invite.acceptedAt, admin.timezone)}`
                          : ` · expires ${formatInTimeZone(invite.expiresAt, admin.timezone)}`}
                      </p>

                      {invite.note ? (
                        <p className="text-xs text-muted-foreground">{invite.note}</p>
                      ) : null}

                      {!invite.acceptedAt && !expired ? (
                        <form action={revokeInviteAction}>
                          <input type="hidden" name="id" value={invite.id} />
                          <Button type="submit" size="sm" variant="outline" data-testid="revoke-invite">
                            Withdraw
                          </Button>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Link href="/admin" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to the dashboard
        </Link>
      </main>
    </>
  );
}
