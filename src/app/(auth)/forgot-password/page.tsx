/**
 * "I cannot get in" (SPEC.md §1).
 *
 * One field, and afterwards a message that does not say whether the address was
 * found. That reads slightly evasive and it is the right trade: the alternative
 * confirms account existence to anybody with a list of email addresses.
 */

import Link from 'next/link';

import { requestResetAction } from '@/app/(auth)/forgot-password/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/select';
import { RESET_TTL_MINUTES } from '@/lib/auth/tokens';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reset your password', robots: { index: false, follow: false } };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-xl font-bold tracking-tight">
        Tutorly<span className="text-primary">.</span>
      </Link>

      {sent ? (
        <Card data-testid="reset-sent">
          <CardHeader>
            <CardTitle as="h1">Check your email</CardTitle>
            <CardDescription>
              If that address has an account, a link to set a new password is on its way. It works
              once and expires in {RESET_TTL_MINUTES} minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Nothing arriving? Check the spam folder, and make sure you used the address you signed
              up with. We cannot tell you which addresses have accounts — that would let anybody
              else find out too.
            </p>
            <Link href="/signin" className="underline underline-offset-4">
              Back to sign in
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle as="h1">Reset your password</CardTitle>
            <CardDescription>
              We will email you a link. It works once and expires in {RESET_TTL_MINUTES} minutes.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form action={requestResetAction} className="flex flex-col gap-4">
              <Field label="Your email" htmlFor="email">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </Field>

              <Button type="submit" size="lg" className="min-h-11" data-testid="request-reset">
                Send the link
              </Button>

              <p className="text-xs text-muted-foreground">
                Resetting your password signs you out everywhere else. It does not touch your
                credits, your bookings or where your payouts go.
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/signin" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}
