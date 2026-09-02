import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { SignUpForm } from '@/components/sign-up-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { defaultLandingPath } from '@/lib/auth/roles';

export const metadata = { title: 'Create an account' };

export default async function SignUpPage() {
  const session = await auth();
  if (session?.user) redirect(defaultLandingPath(session.user.roles));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-6 text-lg font-semibold tracking-tight">
        Tutorly
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>
            Learners buy credits and book sessions. Tutors set their own rates and go through verification
            before they appear in the feed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />
          <p className="mt-4 text-sm text-muted-foreground">
            Already registered?{' '}
            <Link href="/signin" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
