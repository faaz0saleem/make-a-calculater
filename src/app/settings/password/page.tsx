/**
 * Change your password (SPEC.md §1).
 *
 * Says what it will do before it does it: every other session ends. This one
 * survives, because signing somebody out of the device they are typing on is a
 * poor way to confirm that a change worked.
 */

import Link from 'next/link';

import { changePasswordAction } from '@/app/settings/password/actions';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/select';
import { requireUser } from '@/lib/auth/guards';
import { PASSWORD_RULE } from '@/lib/auth/password-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Password' };

export default async function PasswordSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const [, query] = await Promise.all([requireUser(), searchParams]);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Changing it signs you out on every other device. Nothing happens to your credits, your
            bookings or where your payouts go.
          </p>
        </div>

        {query.done ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm" data-testid="password-changed">
            Changed. Every other session has been signed out.
          </p>
        ) : null}

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="password-error">
            {query.error}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">Choose a new one</CardTitle>
            <CardDescription>Your current password first, so we know it is you.</CardDescription>
          </CardHeader>

          <CardContent>
            <form action={changePasswordAction} className="flex flex-col gap-4">
              <Field label="Current password" htmlFor="currentPassword">
                <Input
                  id="currentPassword"
                  name="currentPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </Field>

              <Field label="New password" htmlFor="newPassword" hint={PASSWORD_RULE}>
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </Field>

              <Field label="Type it again" htmlFor="confirm">
                <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" />
              </Field>

              <Button type="submit" className="min-h-11 self-start" data-testid="change-password">
                Change my password
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Cannot remember the current one?{' '}
          <Link href="/forgot-password" className="underline underline-offset-4">
            Reset it by email
          </Link>
          .
        </p>
      </main>
    </>
  );
}
