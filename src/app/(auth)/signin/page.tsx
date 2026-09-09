import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';

import { signIn } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { currentUser } from '@/lib/auth/guards';
import { defaultLandingPath } from '@/lib/auth/roles';
import { isGoogleConfigured } from '@/lib/env';

export const metadata = { title: 'Sign in' };

/**
 * Sign in, and land on this page again when it fails.
 *
 * Auth.js throws on a bad password rather than returning, and an uncaught
 * throw inside a server action is a 500 — so without this, mistyping your
 * password showed "Application error: a server-side exception has occurred"
 * instead of the message three lines below it. Found by walking a reset: the
 * first thing anybody does with a new password is try the old one.
 *
 * The re-throw matters. A *successful* sign-in also throws — that is how
 * `redirectTo` works — so swallowing everything would break the happy path.
 * Only `AuthError` is ours to handle.
 */
async function attemptSignIn(
  provider: 'credentials' | 'google',
  options: Record<string, unknown>,
  back: string,
): Promise<void> {
  try {
    await signIn(provider, options);
  } catch (error) {
    if (error instanceof AuthError) redirect(back);
    throw error;
  }
}

/** Only our own paths: an open redirect is a phishing tool. */
function safeNext(raw: string | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; reset?: string; invited?: string }>;
}) {
  const { error, next: rawNext, reset, invited } = await searchParams;
  const next = safeNext(rawNext);

  // `currentUser()` and not `auth()`: a session whose password has since been
  // reset still has a valid cookie, and bouncing it to the dashboard — which
  // then bounces it back here — is an infinite redirect instead of a sign-in
  // form. Somebody in that state is exactly who needs this page.
  const user = await currentUser();
  if (user) redirect(next ?? defaultLandingPath(user.roles));

  // Every sign-in goes through the landing route, which claims the slot they
  // held before they had an account and then sends them on.
  const landing = `/api/auth/land?next=${encodeURIComponent(next ?? '/dashboard')}`;

  // Where a refused attempt lands. The `next` is carried so somebody who was
  // halfway through booking a lesson still gets back to it once they are in.
  const failedTo = `/signin?error=credentials${next ? `&next=${encodeURIComponent(next)}` : ''}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-6 text-lg font-semibold tracking-tight">
        Tutorly
      </Link>

      <Card>
        <CardHeader>
          <CardTitle as="h1">Sign in</CardTitle>
          <CardDescription>Use your email and password, or continue with Google.</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              We could not sign you in. Check your email and password.
            </p>
          ) : null}

          {reset ? (
            <p role="status" className="rounded-md bg-secondary px-3 py-2 text-sm" data-testid="reset-done">
              Your password is set. Sign in with it — you have been signed out everywhere else.
            </p>
          ) : null}

          {invited ? (
            <p role="status" className="rounded-md bg-secondary px-3 py-2 text-sm">
              Your account is ready. Sign in and finish your profile.
            </p>
          ) : null}

          <form
            className="flex flex-col gap-3"
            action={async (formData: FormData) => {
              'use server';
              await attemptSignIn(
                'credentials',
                {
                  email: String(formData.get('email') ?? ''),
                  password: String(formData.get('password') ?? ''),
                  redirectTo: landing,
                },
                failedTo,
              );
            }}
          >
            <label className="text-sm font-medium" htmlFor="email">
              Email
            </label>
            <Input id="email" name="email" type="email" autoComplete="email" required />

            <label className="text-sm font-medium" htmlFor="password">
              Password
            </label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />

            <p className="text-right text-sm">
              <Link href="/forgot-password" className="underline underline-offset-4">
                Forgot your password?
              </Link>
            </p>

            <Button type="submit" className="mt-2">
              Sign in
            </Button>
          </form>

          {isGoogleConfigured() ? (
            <form
              action={async () => {
                'use server';
                await attemptSignIn('google', { redirectTo: landing }, failedTo);
              }}
            >
              <Button type="submit" variant="outline" className="w-full">
                Continue with Google
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">
              Google sign-in is off: set <code>AUTH_GOOGLE_ID</code> and <code>AUTH_GOOGLE_SECRET</code> to
              enable it.
            </p>
          )}

          <p className="text-sm text-muted-foreground">
            No account?{' '}
            <Link
              href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
              className="underline underline-offset-4"
            >
              Create one
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
