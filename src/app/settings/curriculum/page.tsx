/**
 * "My classes" — where a student manages their curriculum positions.
 *
 * One is primary: the position the feed applies by default. The rest sit
 * alongside it, because a student sitting three A-levels is one student with
 * three positions, not three accounts.
 *
 * Everything here is scoped to the signed-in user. A row id in a form is never
 * trusted to belong to whoever submitted it — the delete is scoped by student
 * id in the same statement.
 */

import Link from 'next/link';

import { declareMyCurriculum, removeMyCurriculum } from '@/app/curriculum/actions';
import { CurriculumFields } from '@/components/curriculum/fields';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { curriculumContextFor } from '@/db/curriculum';
import { listSubjects } from '@/db/discovery';
import { requireUser } from '@/lib/auth/guards';
import { countryFromTimeZone } from '@/lib/geo/timezone-country';

export const dynamic = 'force-dynamic';

const RETURN_TO = '/settings/curriculum';

export default async function CurriculumSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ curriculumError?: string }>;
}) {
  const user = await requireUser();
  const { curriculumError } = await searchParams;

  const [{ boards, declared }, subjects] = await Promise.all([
    curriculumContextFor(user.id, countryFromTimeZone(user.timezone)),
    listSubjects(),
  ]);

  const primary = declared.find((entry) => entry.isPrimary);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My classes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Which exam board and class you are studying, and for which subjects. We show tutors who teach
            your syllabus first — a tutor who knows your papers is worth more than a slightly higher rating.
          </p>
        </div>

        {curriculumError ? (
          <p role="alert" className="text-sm text-[var(--destructive)]">
            {curriculumError === 'incomplete'
              ? 'Pick a board, a class and a subject.'
              : 'That subject could not be found.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">What you are studying</CardTitle>
            <CardDescription>
              {declared.length === 0
                ? 'Nothing yet. Add your first class below and the feed will start matching on it.'
                : 'Your main class is the one applied to the feed by default. You can clear it on the feed at any time.'}
            </CardDescription>
          </CardHeader>

          {declared.length > 0 ? (
            <CardContent>
              <ul className="flex flex-col gap-2">
                {declared.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    data-testid="student-position"
                  >
                    <span className="flex items-center gap-2">
                      {entry.boardName} · {entry.levelName} · {entry.subjectName}
                      {entry.isPrimary ? (
                        <Badge variant="success" className="text-[10px]">
                          Main
                        </Badge>
                      ) : null}
                    </span>

                    <form action={removeMyCurriculum}>
                      <input type="hidden" name="id" value={entry.id} />
                      <input type="hidden" name="returnTo" value={RETURN_TO} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        aria-label={`Remove ${entry.boardName} ${entry.levelName} ${entry.subjectName}`}
                      >
                        Remove
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>

              {primary ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Removing your main class promotes the next one, so the feed always knows what to match on.
                </p>
              ) : null}
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{declared.length === 0 ? 'Add your class' : 'Add another class'}</CardTitle>
            <CardDescription>
              {declared.length === 0
                ? 'This becomes your main class.'
                : 'Sitting more than one subject? Add each one — a tutor matching any of them counts as a match.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={declareMyCurriculum} className="flex flex-col gap-4">
              <input type="hidden" name="returnTo" value={RETURN_TO} />
              {declared.length > 0 ? <input type="hidden" name="secondary" value="1" /> : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <CurriculumFields
                  boards={boards}
                  subjects={subjects}
                  value={{}}
                  required
                  anySubjectLabel="Choose a subject"
                />
              </div>

              <Button type="submit" className="self-start" size="sm">
                {declared.length === 0 ? 'Save my class' : 'Add this class'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {declared.length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Change your main class</CardTitle>
              <CardDescription>
                The main class is the one the feed applies by default. Setting a class you already have
                simply promotes it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={declareMyCurriculum} className="flex flex-col gap-4">
                <input type="hidden" name="returnTo" value={RETURN_TO} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <CurriculumFields
                    boards={boards}
                    subjects={subjects}
                    value={
                      primary
                        ? {
                            board: primary.boardId,
                            level: primary.levelId,
                            subject: primary.subjectSlug,
                          }
                        : {}
                    }
                    required
                    anySubjectLabel="Choose a subject"
                  />
                </div>
                <Button type="submit" variant="outline" size="sm" className="self-start">
                  Make this my main class
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <p className="text-sm text-muted-foreground">
          <Link href="/" className="underline underline-offset-4">
            Back to the feed
          </Link>
        </p>
      </main>
    </>
  );
}
