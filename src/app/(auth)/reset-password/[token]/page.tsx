/**
 * Choosing a new password (SPEC.md §1).
 *
 * The token is not checked before rendering the form, on purpose. Looking it up
 * here and saying "that link is dead" before anybody types would turn this page
 * into an oracle for which tokens are live. The form posts, the claim happens
 * in one transaction, and an unusable link is one message afterwards.
 */

import Link from 'next/link';

import { resetPasswordAction } from '@/app/(auth)/reset-password/[token]/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/select';
import { PASSWORD_RULE } from '@/lib/auth/password-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set a new password', robots: { index: false, follow: false } };

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-xl font-bold tracking-tight">
        Tutorly<span className="text-primary">.</span>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle as="h1">Set a new password</CardTitle>
          <CardDescription>
            This signs you out on every other device. Your credits, your bookings and your payout
            details are untouched.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {query.error ? (
            <p
              role="alert"
              className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
              data-testid="reset-error"
            >
              {query.error}{' '}
              <Link href="/forgot-password" className="underline underline-offset-4">
                Ask for a new link
              </Link>
              .
            </p>
          ) : null}

          <form action={resetPasswordAction.bind(null, token)} className="flex flex-col gap-4">
            <Field label="New password" htmlFor="password" hint={PASSWORD_RULE}>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                autoFocus
              />
            </Field>

            <Field label="Type it again" htmlFor="confirm">
              <Input
                id="confirm"
                name="confirm"
                type="password"
                required
                autoComplete="new-password"
              />
            </Field>

            <Button type="submit" size="lg" className="min-h-11" data-testid="set-password">
              Set my password
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
