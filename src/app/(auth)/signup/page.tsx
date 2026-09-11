import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { SignUpForm } from '@/components/sign-up-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { currentUser } from '@/lib/auth/guards';
import { defaultLandingPath } from '@/lib/auth/roles';
import { isGoogleConfigured } from '@/lib/env';

export const metadata = { title: 'Create an account' };

/** Only our own paths: an open redirect is a phishing tool. */
function safeNext(raw: string | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; held?: string }>;
}) {
  const { next: rawNext, held } = await searchParams;
  const next = safeNext(rawNext);

  // The guard, not the raw session: a stale cookie must not bounce somebody
  // between here and a dashboard they cannot open.
  const user = await currentUser();
  if (user) redirect(next ?? defaultLandingPath(user.roles));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-6 text-lg font-semibold tracking-tight">
        Tutorly
      </Link>

      <Card>
        <CardHeader>
          <CardTitle as="h1">Create an account</CardTitle>
          <CardDescription>
            An email and a password, and you can start browsing. We ask for your class, your name and
            your number later, each at the point where it does something for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {held ? (
            <p
              className="mb-4 rounded-md bg-secondary px-3 py-2 text-sm"
              role="status"
              data-testid="held-notice"
            >
              <strong>That time is held for you for ten minutes.</strong> Finish here and you will land
              straight back on it.
            </p>
          ) : null}

          <SignUpForm googleEnabled={isGoogleConfigured()} next={next} />
          <p className="mt-4 text-sm text-muted-foreground">
            Already registered?{' '}
            {/* Carrying `next` matters here more than anywhere: a returning
                student who picked a slot arrives on this page, and the sign-in
                link was dropping the slot they had chosen. The link the other
                way has always carried it. */}
            <Link
              href={next ? `/signin?next=${encodeURIComponent(next)}` : '/signin'}
              className="underline underline-offset-4"
            >
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
