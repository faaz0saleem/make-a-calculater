/**
 * Covered against remaining, for one student and one tutor (SPEC.md §4).
 *
 * This is the retention engine, and it works by being honest rather than
 * encouraging. A bar that crept up on its own would be worth nothing; a bar
 * that moves only when a tutor says a chapter was actually covered is worth
 * booking the next lesson for.
 *
 * Remaining chapters are listed, not hidden behind a total. "Eight left" is a
 * statistic; "Electrolysis, Chemical energetics, Organic chemistry" is a
 * reason to book Tuesday.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { progressFor } from '@/db/topics';
import { requireUser } from '@/lib/auth/guards';
import { cn } from '@/lib/utils';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your progress' };

const GRASP_LABELS: Record<string, string> = {
  struggling: 'Needs another look',
  developing: 'Getting there',
  secure: 'Secure',
};

export default async function ProgressPage({ params }: { params: Promise<{ tutorId: string }> }) {
  const [{ tutorId }, user] = await Promise.all([params, requireUser()]);

  const [tutor] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, tutorId))
    .limit(1);

  if (!tutor) notFound();

  const groups = await progressFor(user.id, tutorId);
  const total = groups.reduce((sum, group) => sum + group.totalCount, 0);
  const covered = groups.reduce((sum, group) => sum + group.coveredCount, 0);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Your progress with {tutor.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total === 0
              ? 'Once you have told us what you study, your chapters appear here.'
              : `${covered} of ${total} chapters covered.`}
          </p>
        </div>

        {groups.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-5 text-sm text-muted-foreground">
              <p>
                We do not know what you are studying yet, so there is nothing to track. Tell us your
                board, class and subject and this fills in.
              </p>
              <Link href="/settings/curriculum">
                <Button size="sm" variant="outline">
                  Set your syllabus
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {groups.map((group) => {
          const percent =
            group.totalCount > 0 ? Math.round((group.coveredCount * 100) / group.totalCount) : 0;
          const remaining = group.rows.filter((row) => !row.covered);

          return (
            <Card key={`${group.boardName}-${group.levelName}-${group.subjectName}`} data-testid="progress-group">
              <CardHeader>
                <CardTitle as="h2">{group.subjectName}</CardTitle>
                <CardDescription>
                  {group.boardName} · {group.levelName} · {group.coveredCount} of {group.totalCount}{' '}
                  covered
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <div>
                  <div
                    className="h-3 w-full overflow-hidden rounded-full bg-secondary"
                    role="img"
                    aria-label={`${percent}% of ${group.subjectName} covered`}
                  >
                    <div
                      className="h-full bg-foreground/70"
                      style={{ width: `${percent}%` }}
                      data-testid="progress-bar"
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{percent}%</p>
                </div>

                <ul className="flex flex-col divide-y divide-border text-sm">
                  {group.rows.map((row) => (
                    <li
                      key={row.topicId}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                      data-testid="progress-row"
                      data-covered={row.covered ? 'yes' : 'no'}
                    >
                      <span className={cn(row.covered ? '' : 'text-muted-foreground')}>
                        {row.reference ? (
                          <span className="text-muted-foreground">{row.reference} </span>
                        ) : null}
                        {row.name}
                      </span>

                      <span className="flex items-center gap-2">
                        {row.grasp ? (
                          <Badge variant={row.grasp === 'secure' ? 'success' : 'secondary'}>
                            {GRASP_LABELS[row.grasp] ?? row.grasp}
                          </Badge>
                        ) : null}
                        {row.covered ? (
                          <Badge variant="outline">Covered</Badge>
                        ) : row.timesBooked > 0 ? (
                          <span className="text-xs text-muted-foreground">Booked, not yet covered</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>

                {remaining.length > 0 ? (
                  <div className="rounded-md bg-secondary px-3 py-2 text-sm">
                    <p className="font-medium">
                      {remaining.length} to go
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Next up: {remaining.slice(0, 3).map((row) => row.name).join(', ')}
                      {remaining.length > 3 ? '…' : ''}
                    </p>
                    <Link href={`/tutors/${tutorId}?mode=60`}>
                      <Button size="sm" className="mt-2" data-testid="book-next">
                        Book the next one
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <p className="rounded-md bg-secondary px-3 py-2 text-sm">
                    Every chapter covered. Worth a past paper.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Link href="/dashboard" className="text-sm text-muted-foreground underline underline-offset-4">
          Back
        </Link>
      </main>
    </>
  );
}
