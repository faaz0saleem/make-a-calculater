/**
 * Home — the feed and search.
 *
 * Phase 2 turns this into the video-first infinite grid with rails and filters
 * from SPEC.md §4. What it already does correctly is who it shows: the query
 * lives in `findVisibleTutors`, which is the one place the "verified only" rule
 * is written down.
 */

import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { findVisibleTutors } from '@/db/tutors';
import { formatCents } from '@/lib/money/cents';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';
  const tutors = await findVisibleTutors({ query });

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Find a tutor worth your hour</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Watch a 60-second intro before you commit. Buy credits, book a 30 or 60 minute session, and take
            the lesson right here. Most tutors offer a free trial first.
          </p>

          <form className="mt-5 flex max-w-lg gap-2" action="/">
            <Input
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search by name, subject or what they teach"
              aria-label="Search tutors"
            />
            <Button type="submit">Search</Button>
          </form>

          <p className="mt-3 text-sm text-muted-foreground">
            {query
              ? `${tutors.length} verified tutor${tutors.length === 1 ? '' : 's'} matching “${query}”.`
              : `${tutors.length} verified tutors. Only verified tutors appear here.`}
          </p>
        </section>

        {tutors.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{query ? 'No matches' : 'No tutors yet'}</CardTitle>
              <CardDescription>
                {query ? (
                  <>
                    Nothing matched “{query}”.{' '}
                    <Link href="/" className="underline underline-offset-4">
                      Clear the search
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    Run <code className="rounded bg-secondary px-1.5 py-0.5">pnpm seed</code> to build the
                    development world.
                  </>
                )}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tutors.map((tutor) => (
              <Link key={tutor.id} href={`/tutors/${tutor.id}`} className="group">
                <Card className="flex h-full flex-col transition-colors group-hover:border-primary">
                  <CardHeader>
                    <div className="aspect-video rounded-md bg-secondary" aria-hidden />
                    <CardTitle className="mt-3">{tutor.name}</CardTitle>
                    <CardDescription className="line-clamp-2">{tutor.headline}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex flex-col gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {tutor.subjects.slice(0, 3).map((subject) => (
                        <Badge key={subject} variant="secondary">
                          {subject}
                        </Badge>
                      ))}
                      {tutor.offersTrial ? <Badge variant="success">Free trial</Badge> : null}
                    </div>

                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">
                        {tutor.promoCents ? (
                          <>
                            <span className="mr-1.5 text-muted-foreground line-through">
                              {formatCents(tutor.hourlyCents)}
                            </span>
                            {formatCents(tutor.promoCents)}
                          </>
                        ) : (
                          formatCents(tutor.hourlyCents)
                        )}
                        <span className="text-muted-foreground">/hr</span>
                      </span>
                      <span className="text-muted-foreground">
                        ★ {((tutor.ratingMilli ?? 4_300) / 1_000).toFixed(1)} ({tutor.reviewCount ?? 0})
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {tutor.city}, {tutor.country} · {tutor.timezone} ·{' '}
                      {formatCents(tutor.halfHourCents)} per 30 min
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 text-sm text-muted-foreground">
          Credits never expire and are non-refundable to cash — refunds are returned as credits.{' '}
          <Link href="/signup" className="underline underline-offset-4">
            Create an account
          </Link>
        </div>
      </footer>
    </>
  );
}
