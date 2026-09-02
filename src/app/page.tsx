/**
 * Home.
 *
 * Phase 2 turns this into the video-first infinite grid from SPEC.md §4. For
 * now it proves the schema and the seed: verified tutors only, priced from the
 * snapshot-safe rate columns, ordered by the nightly ranking table.
 */

import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db/client';
import { tutorProfiles, tutorRanking, users } from '@/db/schema';
import { formatCents } from '@/lib/money/cents';

export const dynamic = 'force-dynamic';

async function getFeed() {
  return db
    .select({
      id: users.id,
      name: users.name,
      country: users.country,
      city: users.city,
      timezone: users.timezone,
      headline: tutorProfiles.headline,
      hourlyCents: tutorProfiles.hourlyCents,
      halfHourCents: tutorProfiles.halfHourCents,
      promoCents: tutorProfiles.promoCents,
      offersTrial: tutorProfiles.offersTrial,
      ratingMilli: tutorRanking.bayesianRatingMilli,
      reviewCount: tutorRanking.reviewCount,
      sessionCount: tutorRanking.sessionCount,
      subjects: sql<string[]>`
        coalesce(
          (select array_agg(s.name order by s.name)
           from tutor_subjects ts join subjects s on s.id = ts.subject_id
           where ts.tutor_id = ${users.id}),
          '{}'
        )
      `,
    })
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .leftJoin(tutorRanking, eq(tutorRanking.tutorId, tutorProfiles.userId))
    // Unverified tutors are invisible in the feed (SPEC.md §3).
    .where(eq(tutorProfiles.status, 'verified'))
    .orderBy(desc(tutorRanking.score))
    .limit(40);
}

export default async function HomePage() {
  const tutors = await getFeed();

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">Find a tutor worth your hour</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Watch a 60-second intro before you commit. Buy credits, book a 30 or 60 minute session, and take
            the lesson right here. Most tutors offer a free trial first.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Phase 0 of {tutors.length} seeded tutors — the video grid, search and booking calendar arrive in
            phases 2 and 3.
          </p>
        </section>

        {tutors.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No tutors yet</CardTitle>
              <CardDescription>
                Run <code className="rounded bg-secondary px-1.5 py-0.5">pnpm seed</code> to build the
                development world.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tutors.map((tutor) => (
              <Card key={tutor.id} className="flex flex-col">
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
                    {tutor.city}, {tutor.country} · {tutor.timezone} · {formatCents(tutor.halfHourCents)} per
                    30 min
                  </p>
                </CardContent>
              </Card>
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
