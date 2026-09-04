import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth, signIn } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { defaultLandingPath } from '@/lib/auth/roles';
import { isGoogleConfigured } from '@/lib/env';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect(defaultLandingPath(session.user.roles));

  const { error } = await searchParams;

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

          <form
            className="flex flex-col gap-3"
            action={async (formData: FormData) => {
              'use server';
              await signIn('credentials', {
                email: String(formData.get('email') ?? ''),
                password: String(formData.get('password') ?? ''),
                redirectTo: '/dashboard',
              });
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

            <Button type="submit" className="mt-2">
              Sign in
            </Button>
          </form>

          {isGoogleConfigured() ? (
            <form
              action={async () => {
                'use server';
                await signIn('google', { redirectTo: '/dashboard' });
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
            <Link href="/signup" className="underline underline-offset-4">
              Create one
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
