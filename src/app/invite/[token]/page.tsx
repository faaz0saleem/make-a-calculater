/**
 * "Somebody invited you to teach here" (SPEC.md §3).
 *
 * The first thing a hand-recruited tutor sees, and probably on a phone, from a
 * WhatsApp message. It has to do three things in that order: prove it is real
 * by knowing who they are, say what happens next, and ask for the two facts it
 * cannot proceed without.
 *
 * What it does not do is ask for documents. Somebody the founder already met
 * does not photograph a degree certificate to satisfy a queue of one — that is
 * the whole point of the invite, and saying so here is what makes the link feel
 * like a shortcut rather than a form.
 */

import Link from 'next/link';

import { acceptInviteAction } from '@/app/invite/[token]/actions';
import { TimezoneProbe, TIMEZONE_COOKIE } from '@/components/timezone-probe';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/select';
import { inviteByToken } from '@/db/invites';
import { PASSWORD_RULE } from '@/lib/auth/password-rules';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your invitation', robots: { index: false, follow: false } };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, query, jar] = await Promise.all([params, searchParams, cookies()]);
  const invite = await inviteByToken(token);
  const timezone = jar.get(TIMEZONE_COOKIE)?.value ?? 'UTC';

  if (!invite) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-6 py-16">
        <p className="text-xl font-bold tracking-tight">Tutorly.</p>
        <h1 className="text-2xl font-semibold tracking-tight">That invitation is not usable</h1>
        <p className="text-sm leading-6">
          {/* Deliberately one message for unknown, expired and already used. Which
              of the three it was is information about somebody else's link. */}
          It may have been used already, or it may have expired — they last two weeks. Ask whoever
          sent it for a new one.
        </p>
        <p className="text-sm">
          <Link href="/teach" className="underline underline-offset-4">
            Or apply the ordinary way
          </Link>
        </p>
      </main>
    );
  }

  return (
    <>
      <TimezoneProbe current={jar.get(TIMEZONE_COOKIE)?.value ?? null} />

      <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-12">
        <p className="text-xl font-bold tracking-tight">Tutorly.</p>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {invite.name ? `${invite.name}, you have been invited to teach` : 'You have been invited to teach'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This link was made for <strong>{invite.email}</strong> and works once.
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">What happens next</CardTitle>
            <CardDescription>Three things, and the first two take a minute.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
              <li>Set a password below. That is your account.</li>
              <li>
                Tell us what you teach, what you charge and when you are free. Nobody can answer
                those for you, and students search on them.
              </li>
              <li>
                {invite.preVerified ? (
                  <>
                    <strong>No document review.</strong> Whoever invited you has already vouched for
                    your credentials, so your profile goes live as soon as you finish it.
                  </>
                ) : (
                  <>Upload a credential for review, and we will come back to you.</>
                )}
              </li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Set up your account</CardTitle>
          </CardHeader>

          <CardContent>
            <form action={acceptInviteAction.bind(null, token)} className="flex flex-col gap-4">
              <input type="hidden" name="timezone" value={timezone} />

              <Field label="Your name" htmlFor="name" hint="As students will see it.">
                <Input
                  id="name"
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={invite.name ?? ''}
                  autoComplete="name"
                />
              </Field>

              <Field label="A password" htmlFor="password" hint={PASSWORD_RULE}>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </Field>

              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  name="isAdult"
                  required
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                />
                <span>
                  I am 18 or over. Tutors are paid, sign an agreement and teach minors, so this one
                  is not optional.
                </span>
              </label>

              <p className="text-xs text-muted-foreground">
                By continuing you accept the{' '}
                <Link href="/tutor-agreement" className="underline underline-offset-4">
                  tutor agreement
                </Link>{' '}
                and the{' '}
                <Link href="/terms" className="underline underline-offset-4">
                  terms
                </Link>
                .
              </p>

              <Button type="submit" size="lg" className="min-h-11" data-testid="accept-invite">
                Create my account
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
