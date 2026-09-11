'use client';

/**
 * What a person sees when a page fails.
 *
 * Until this existed there was no error boundary anywhere in the app, so any
 * unhandled failure — a database blip, a dead R2, a query that threw — rendered
 * Next's production default: the words "Application error: a server-side
 * exception has occurred" and a digest number. On the booking screen that told
 * a student nothing about the credits they were about to spend.
 *
 * Three jobs, in order of how much they matter:
 *
 *  1. Say whether money moved. Somebody who was mid-purchase needs that
 *     sentence before anything else, and the honest version is conditional:
 *     nothing is charged until a confirmation, and a confirmation is a screen
 *     they would remember seeing.
 *  2. Offer a way out. A dead end with a digest on it is where people leave.
 *  3. Carry the digest, quietly, so support can find the log line.
 */

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-xl font-bold tracking-tight">
        Tutorly<span className="text-primary">.</span>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle as="h1">Something went wrong at our end</CardTitle>
          <CardDescription>
            Not something you did. The page could not be loaded, and trying again often works.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="rounded-md bg-secondary px-3 py-2">
            <strong>Nothing has been charged.</strong> Credits only move when you press a button
            that names the amount and you are shown a confirmation afterwards — if you did not see
            one, the money is still in your balance.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={reset} className="min-h-11">
              Try again
            </Button>
            <Link href="/dashboard">
              <Button variant="outline" className="min-h-11">
                Go to your dashboard
              </Button>
            </Link>
          </div>

          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              If you need to tell us about this, the reference is{' '}
              <code className="font-mono">{error.digest}</code>.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
