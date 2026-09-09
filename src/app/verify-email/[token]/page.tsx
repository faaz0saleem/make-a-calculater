/**
 * Confirming an address (SPEC.md §1).
 *
 * Public on purpose. Somebody who reads mail on their phone and is signed in
 * on their laptop should not be asked to sign in on the phone first — the
 * token is the claim, and requiring a session on top of it turns a one-tap
 * confirmation into a password prompt at the worst possible moment.
 *
 * The work happens on GET, which is unusual and correct here: a link in an
 * email is a GET, and asking somebody to press a second button after clicking
 * the link in the email is the kind of ceremony that loses people. It is safe
 * because the token is single use, unguessable and does nothing but set a
 * flag — there is no money, no destructive act, and a link scanner opening it
 * confirms an address its owner asked us to confirm.
 */

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { confirmEmailVerification } from '@/db/verification';
import { VERIFIED_PURCHASE_THRESHOLD_CENTS } from '@/lib/auth/verification';
import { formatCents } from '@/lib/money/cents';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirm your email', robots: { index: false, follow: false } };

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await confirmEmailVerification(token);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-xl font-bold tracking-tight">
        Tutorly<span className="text-primary">.</span>
      </Link>

      {result.ok ? (
        <Card data-testid="verify-ok">
          <CardHeader>
            <CardTitle as="h1">
              {result.alreadyDone ? 'Already confirmed' : 'Email confirmed'}
            </CardTitle>
            <CardDescription>{result.email}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="text-muted-foreground">
              Payouts and purchases over {formatCents(VERIFIED_PURCHASE_THRESHOLD_CENTS)} are open.
              Everything else already was.
            </p>
            <Link href="/dashboard">
              <Button className="min-h-11">Go to your dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="verify-failed">
          <CardHeader>
            <CardTitle as="h1">That link did not work</CardTitle>
            <CardDescription>{result.message}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="text-muted-foreground">
              Nothing is broken and nothing is locked. You can keep browsing, booking and teaching
              while this is unconfirmed — ask for a new link when it suits you.
            </p>
            <Link href="/settings/email">
              <Button variant="outline" className="min-h-11">
                Send me another
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
