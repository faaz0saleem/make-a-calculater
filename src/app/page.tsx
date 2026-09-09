/**
 * Home — the discovery feed (SPEC.md §4).
 *
 * Category chips, then the rails, then the ranked grid. Ordering comes from
 * `tutor_ranking.score`, which the nightly job writes; nothing here computes a
 * ranking.
 *
 * When filters or a search term are present the rails step aside and the page
 * becomes a plain result list, because that is what someone who typed a query
 * is asking for.
 *
 * A signed-in student who has declared a curriculum gets it applied here by
 * default — visibly, in a banner, clearable in one tap. Their declaration is
 * read from the session, never from the URL, so nobody can rank themselves up
 * by editing a query string.
 */

import Link from 'next/link';
import { cookies, headers } from 'next/headers';

import { SignedOutIntro } from '@/app/(marketing)/_components/signed-out-intro';
import { CategoryChips } from '@/components/feed/category-chips';
import { CurriculumBanner } from '@/components/feed/curriculum-banner';
import { CurriculumPrompt } from '@/components/feed/curriculum-prompt';
import { Filters } from '@/components/feed/filters';
import { Rail } from '@/components/feed/rail';
import { TutorCard } from '@/components/feed/tutor-card';
import { SiteHeader } from '@/components/site-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  listSubjects,
  listTutorCountries,
  railAvailableSoon,
  railContinueWithYourTutors,
  railForYourCurriculum,
  railFreeTrials,
  railNewTutors,
  railTopRatedInSubject,
  searchTutors,
  SORT_OPTIONS,
  type CurriculumFilter,
  type DiscoveryFilters,
  type SortOption,
  type ViewerContext,
} from '@/db/discovery';
import {
  curriculumContextFor,
  toPosition,
  type BoardOption,
  type StudentCurriculumEntry,
} from '@/db/curriculum';
import { knownViewerTimezone } from '@/lib/geo/infer';
import { CURRICULUM_PROMPT_COOKIE } from '@/lib/students/prompts';
import { TIMEZONE_COOKIE, TimezoneProbe } from '@/components/timezone-probe';
import { currentUser } from '@/lib/auth/guards';
import { countryFromTimeZone } from '@/lib/geo/timezone-country';
import { isValidTimeZone, zonedTimeToUtc } from '@/lib/time';
import { toCardData } from '@/lib/tutors/card';
import {
  nearestPositions,
  recordCurriculumInterest,
  subjectsWithTutors,
  visibleTutorCount,
} from '@/db/demand';
import { feedShape, smallCatalogueNote } from '@/lib/discovery/inventory';
import { hasQueryParameters, pageMetadata } from '@/lib/seo/site';
import { LAST_SUBJECT_COOKIE } from '@/middleware';

export const dynamic = 'force-dynamic';

/**
 * One canonical for the feed, and no index on any filtered variant.
 *
 * `/?board=caie&level=a-level` is the same page as `/` with a question asked of
 * it. Letting each combination be indexed separately is how a marketplace ends
 * up competing with itself for its own name — and the editorial pages in
 * `(seo)` are the ones written to rank for those queries anyway
 * (CODEX_NOTES.md, boundary stop 3).
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return pageMetadata(
    'Find a tutor worth your hour',
    'Watch a minute of someone teaching before you book them. Every lesson is live, one to one, on video or voice.',
    '/',
    !hasQueryParameters(params),
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

function dollarsToCents(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const dollars = Number(value);
  return Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : undefined;
}

/**
 * The day-and-time window, read in the *viewer's* timezone.
 *
 * "Free on Tuesday between 18:00 and 21:00" means their evening, not a UTC one,
 * so the conversion has to happen with their zone rather than the server's.
 */
function parseTimeWindow(
  params: SearchParams,
  timezone: string,
): { from?: Date; to?: Date; raw: { date?: string; from?: string; to?: string } } {
  const date = first(params, 'availDate');
  const from = first(params, 'availFrom');
  const to = first(params, 'availTo');
  const raw = { date, from, to };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { raw };

  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const parseTime = (value: string | undefined, fallback: [number, number]): [number, number] => {
    const match = value?.match(/^(\d{1,2}):(\d{2})$/);
    return match ? [Number(match[1]), Number(match[2])] : fallback;
  };

  const [fromHour, fromMinute] = parseTime(from, [0, 0]);
  const [toHour, toMinute] = parseTime(to, [23, 59]);

  const startUtc = zonedTimeToUtc({ year, month, day, hour: fromHour, minute: fromMinute }, timezone);
  const endUtc = zonedTimeToUtc({ year, month, day, hour: toHour, minute: toMinute }, timezone);

  if (endUtc <= startUtc) return { raw };
  return { from: startUtc, to: endUtc, raw };
}

function parseFilters(params: SearchParams): DiscoveryFilters {
  const sort = first(params, 'sort');
  const minRating = Number(first(params, 'minRating'));

  return {
    q: first(params, 'q'),
    subject: first(params, 'subject'),
    minPriceCents: dollarsToCents(first(params, 'minPrice')),
    maxPriceCents: dollarsToCents(first(params, 'maxPrice')),
    minRatingMilli: Number.isFinite(minRating) && minRating > 0 ? minRating : undefined,
    language: first(params, 'language'),
    hasFreeTrial: first(params, 'freeTrial') === '1',
    country: first(params, 'country'),
    sort: (SORT_OPTIONS as readonly string[]).includes(sort ?? '') ? (sort as SortOption) : 'relevance',
    limit: 24,
  };
}

/** True when the visitor asked a question, rather than just arriving. */
function isBrowsing(filters: DiscoveryFilters): boolean {
  return !(
    filters.q ||
    filters.subject ||
    filters.minPriceCents ||
    filters.maxPriceCents ||
    filters.minRatingMilli ||
    filters.language ||
    filters.hasFreeTrial ||
    filters.country ||
    filters.availableFromUtc ||
    (filters.sort && filters.sort !== 'relevance')
  );
}

/**
 * Which curriculum position, if any, this request should match on.
 *
 * A board or class in the URL is the student's own filter and always wins. A
 * declared primary position applies when they have not filtered by hand and
 * have not cleared it. `noCurriculum=1` is the cleared state — one tap, and it
 * lives in the URL, so it is shareable and the back button undoes it.
 *
 * A `subject` in the URL always wins over the subject of the declared
 * position. A student who sits CAIE AS Maths and clicks the Chemistry chip
 * means "CAIE AS Chemistry", not "nothing" — and the banner shows them exactly
 * that, so the substitution is never silent.
 */
function chooseCurriculum(
  params: SearchParams,
  declared: StudentCurriculumEntry[],
  boards: BoardOption[],
  subjects: { id: string; slug: string; name: string }[],
): {
  filter: CurriculumFilter | undefined;
  source: 'profile' | 'filter' | null;
  summary: { boardName: string; levelName: string; subjectName: string } | null;
  raw: { board?: string; level?: string };
} {
  const nothing = { filter: undefined, source: null, summary: null, raw: {} } as const;

  const exactOnly = first(params, 'exact') === '1';
  const cleared = first(params, 'noCurriculum') === '1';
  const subjectSlug = first(params, 'subject');
  const chosenSubject = subjects.find((subject) => subject.slug === subjectSlug);

  const urlBoard = first(params, 'board');
  const urlLevel = first(params, 'level');
  const primary = declared.find((entry) => entry.isPrimary);

  const byHand = Boolean(urlBoard || urlLevel);
  if (!byHand && (cleared || !primary)) return nothing;

  const boardId = byHand ? urlBoard : primary!.boardId;
  const levelId = byHand ? urlLevel : primary!.levelId;

  // The level carries its stage, which is what lets a near match mean "the same
  // rung under another board" rather than anything looser. Both are looked up
  // in the real board list rather than trusted from the URL.
  const board = boards.find((candidate) => candidate.id === boardId);
  const level = board?.levels.find((candidate) => candidate.id === levelId);

  // A made-up board or class filters to nothing and says nothing about why.
  // Ignoring it shows the whole feed, which is the honest reading of a
  // hand-edited URL nobody meant to break.
  if ((boardId && !board) || (levelId && !level)) return nothing;

  const subjectId = chosenSubject?.id ?? (byHand ? undefined : primary!.subjectId);
  const subjectName =
    chosenSubject?.name ?? (byHand ? undefined : primary!.subjectName) ?? 'any subject';

  return {
    filter: {
      boardId,
      levelId,
      subjectId,
      stage: level?.stage,
      includeNearMatches: !exactOnly && Boolean(level),
    },
    source: byHand ? 'filter' : 'profile',
    summary: board
      ? { boardName: board.name, levelName: level?.name ?? 'any class', subjectName }
      : null,
    raw: { board: boardId, level: levelId },
  };
}

/** A copy of the current query string with some keys changed or dropped. */
function hrefWith(params: SearchParams, changes: Record<string, string | null>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single && !(key in changes)) next.set(key, single);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value !== null) next.set(key, value);
  }
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  const [viewer, jar, allSubjects, countries, teachable] = await Promise.all([
    currentUser(),
    cookies(),
    listSubjects(),
    listTutorCountries(),
    subjectsWithTutors(),
  ]);

  // How many tutors exist, not how many match. A student whose class narrows
  // the feed to two is looking at a narrow result, not an empty marketplace,
  // and must keep the filters that let them widen it.
  const catalogueSize = await visibleTutorCount();

  // Chips are built from what is actually bookable, not from every subject the
  // catalogue defines. A chip that leads to an empty page is a dead end
  // somebody blames themselves for, and with three tutors most of them would.
  const teachableSlugs = new Set(teachable.map((row) => row.slug));
  const chipSubjects = allSubjects.filter((subject) => teachableSlugs.has(subject.slug));
  // The filter dropdown keeps every subject: narrowing to nothing is a
  // deliberate act there, and the empty state answers it properly.
  const subjects = allSubjects;

  // Two different things, deliberately. `knownTimezone` is null when nobody has
  // told us where the viewer is, and the timezone-overlap term stays out of the
  // ordering rather than assuming UTC. `timezone` is what times are *rendered*
  // in, where UTC is the honest last resort.
  const knownTimezone = knownViewerTimezone({
    accountTimezone: viewer?.timezone,
    cookieValue: jar.get(TIMEZONE_COOKIE)?.value,
    headers: await headers(),
  });
  const timezone = knownTimezone ?? 'UTC';

  // The country only decides which boards appear first. A signed-in user's own
  // country wins; a visitor's is guessed from their timezone.
  const { boards, declared } = await curriculumContextFor(
    viewer?.id ?? null,
    countryFromTimeZone(timezone),
  );

  const curriculum = chooseCurriculum(params, declared, boards, subjects);
  // "Not now" hides the class prompt for a fortnight. A cookie, because a
  // dismissal is a browsing preference and it should wear off.
  const promptDismissed = jar.get(CURRICULUM_PROMPT_COOKIE)?.value === 'later';

  const viewerContext: ViewerContext = {
    timezone: knownTimezone,
    positions: declared.map(toPosition),
  };

  const timeWindow = parseTimeWindow(params, timezone);
  const filters: DiscoveryFilters = {
    ...parseFilters(params),
    curriculum: curriculum.filter,
    viewer: viewerContext,
    ...(timeWindow.from && timeWindow.to
      ? {
          availableFromUtc: timeWindow.from,
          availableToUtc: timeWindow.to,
          availableDurationMinutes: 30,
        }
      : {}),
  };

  const results = await searchTutors(filters);

  const emptyPosition = curriculum.summary
    ? `${curriculum.summary.boardName} ${curriculum.summary.levelName} ${curriculum.summary.subjectName}`
    : 'that class';

  // The default-applied match is not a question the visitor asked, so it does
  // not send the rails away. A board or class they typed themselves does.
  const browsing = isBrowsing(filters) && curriculum.source !== 'filter';
  const grid = await toCardData(results.tutors, timezone);

  // How much there is decides the shape of the page. With three tutors, rails
  // are the grid again under a different heading, which reads as padding.
  const shape = feedShape(catalogueSize, browsing);

  // Somebody asked for a curriculum position and got nothing. Record it — this
  // is the single most useful thing to know before recruiting the next tutor —
  // and find them the nearest thing they could actually book.
  const missed =
    grid.length === 0 && curriculum.filter && curriculum.raw.board && curriculum.raw.level
      ? await (async () => {
          const subjectId = subjects.find((subject) => subject.slug === filters.subject)?.id;
          if (!subjectId) return null;

          const position = {
            boardId: curriculum.raw.board!,
            levelId: curriculum.raw.level!,
            subjectId,
          };

          await recordCurriculumInterest(position, viewer?.id ?? null);
          return nearestPositions(position);
        })()
      : null;

  const buildHref = (slug: string | undefined) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const single = Array.isArray(value) ? value[0] : value;
      if (single && key !== 'subject') next.set(key, single);
    }
    if (slug) next.set('subject', slug);
    const query = next.toString();
    return query ? `/?${query}` : '/';
  };

  // Rails only when nobody has asked a question.
  const lastSubject = filters.subject ?? jar.get(LAST_SUBJECT_COOKIE)?.value;
  const lastSubjectName = subjects.find((subject) => subject.slug === lastSubject)?.name;

  const [continueRow, trialsRow, newRow, topRatedRow, availableRow, curriculumRow] = browsing
    ? await Promise.all([
        viewer ? railContinueWithYourTutors(viewer.id) : Promise.resolve([]),
        railFreeTrials(undefined, viewerContext),
        railNewTutors(undefined, viewerContext),
        lastSubject ? railTopRatedInSubject(lastSubject) : Promise.resolve([]),
        railAvailableSoon(60, undefined, viewerContext),
        curriculum.source === 'profile'
          ? railForYourCurriculum(viewerContext)
          : Promise.resolve([]),
      ])
    : [[], [], [], [], null, []];

  const [continueCards, trialCards, newCards, topRatedCards, curriculumCards] = await Promise.all([
    toCardData(continueRow, timezone),
    toCardData(trialsRow, timezone),
    toCardData(newRow, timezone),
    toCardData(topRatedRow, timezone),
    toCardData(curriculumRow, timezone),
  ]);

  return (
    <>
      <SiteHeader />
      {/* Compared against the cookie, not against the timezone above: the
          edge's guess is a fallback for rendering, and letting it stand in for
          "what this browser last told us" would stop the probe correcting it. */}
      <TimezoneProbe current={jar.get(TIMEZONE_COOKIE)?.value ?? null} />

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:px-6 py-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Find a tutor worth your hour</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Watch a minute of someone teaching before you book them. Every lesson is live, one to one, on
            video or voice — and most tutors will give you a free trial first.
          </p>
        </section>

        {/* Somebody who has never been here needs to be told what this is before
            being shown a grid of strangers. Somebody who has filtered has already
            asked a question, and the answer should not be below an introduction. */}
        {!viewer && browsing ? <SignedOutIntro /> : null}

        {/* No chips rather than a lone "All" chip standing on its own. */}
        {chipSubjects.length > 0 ? (
          <CategoryChips subjects={chipSubjects} active={filters.subject} buildHref={buildHref} />
        ) : null}

        {viewer && declared.length === 0 && !promptDismissed ? (
          <CurriculumPrompt
            boards={boards}
            subjects={subjects}
            returnTo="/"
            error={
              first(params, 'curriculumError') === 'incomplete'
                ? 'Pick a board, a class and a subject.'
                : first(params, 'curriculumError') === 'subject'
                  ? 'That subject could not be found.'
                  : null
            }
          />
        ) : null}

        {declared.length > 0 || curriculum.source === 'filter' ? (
          <CurriculumBanner
            applied={curriculum.summary}
            source={curriculum.source === 'filter' ? 'filter' : 'profile'}
            restoreHref={hrefWith(params, { noCurriculum: null, board: null, level: null, subject: null })}
            clearHref={
              curriculum.source === 'filter'
                ? hrefWith(params, { board: null, level: null, subject: null, exact: null })
                : hrefWith(params, { noCurriculum: '1' })
            }
          />
        ) : null}

        {shape.showFilters ? (
        <Filters
          filters={filters}
          subjects={subjects}
          boards={boards}
          countries={countries}
          resultCount={results.total}
          timeWindow={timeWindow.raw}
          viewerTimezone={timezone}
          curriculum={curriculum.raw}
          exactOnly={first(params, 'exact') === '1'}
          // Folded when there is little to filter and nothing filtered yet.
          // "Little" is under twenty: at that size scanning the grid is faster
          // than deciding what to narrow, and the panel is taller than its own
          // results. One filter set and it opens again, whatever the size.
          collapsed={shape.foldFilters && browsing && !hasQueryParameters(params)}
        />
        ) : null}

        {shape.showRails ? (
          <>
            {curriculumCards.length > 0 && curriculum.summary ? (
              <Rail
                title={`Tutors for ${curriculum.summary.levelName} ${curriculum.summary.subjectName}`}
                subtitle={`${curriculum.summary.boardName} first, then the same class on other boards.`}
                tutors={curriculumCards}
              />
            ) : null}

            {continueCards.length > 0 ? (
              <Rail
                title="Continue with your tutors"
                subtitle="People you have already had a session with."
                tutors={continueCards}
              />
            ) : null}

            <Rail
              title="Available in the next hour"
              tutors={availableRow ? await toCardData(availableRow, timezone) : undefined}
            />

            <Rail title="Free trials" subtitle="Try a short lesson before you spend anything." tutors={trialCards} />

            <Rail
              title="New tutors"
              subtitle="Recently verified, and worth a look before everyone else finds them."
              tutors={newCards}
            />

            {lastSubjectName && topRatedCards.length > 0 ? (
              <Rail title={`Top rated in ${lastSubjectName}`} tutors={topRatedCards} />
            ) : null}
          </>
        ) : null}

        <section id="tutor-feed" className="flex flex-col gap-4 scroll-mt-6">
          <h2 className="text-lg font-semibold tracking-tight">
            {browsing ? shape.gridHeading : `${results.total} result${results.total === 1 ? '' : 's'}`}
          </h2>

          {shape.acknowledgeSmallCatalogue ? (
            /* Said out loud rather than left for the reader to notice. "12
               tutors matched" over three cards is the sentence that loses
               somebody's trust for good. */
            <p className="text-sm text-muted-foreground" data-testid="small-catalogue">
              {smallCatalogueNote(catalogueSize)}
            </p>
          ) : null}

          {shape.catalogueEmpty ? (
            /* Day one. No filter caused this, so no filter can fix it, and
               saying otherwise would send somebody round a loop. */
            <Card data-testid="catalogue-empty">
              <CardHeader>
                <CardTitle as="h3">No tutors are listed yet</CardTitle>
                <CardDescription>
                  Every tutor here is verified by hand before they appear, and we are working
                  through the first ones now. Nothing is charged for looking, and there is nothing
                  to book today.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-4 text-sm">
                <Link href="/teach" className="underline underline-offset-4">
                  Teach on Tutorly
                </Link>
                <Link href="/signup" className="underline underline-offset-4">
                  Make an account and hear when we open
                </Link>
              </CardContent>
            </Card>
          ) : grid.length === 0 ? (
            <Card>
              <CardHeader>
                {curriculum.filter ? (
                  <>
                    <CardTitle as="h3">
                      No tutor teaches {emptyPosition} yet
                    </CardTitle>
                    <CardDescription>
                      {/* Recorded, whether or not they are signed in. The admin
                          dashboard reads it as the list of who to recruit next,
                          and saying so is more honest than a silent log. */}
                      We have noted that you looked. It is what decides which
                      tutor we go and find next.
                    </CardDescription>

                    {missed && missed.length > 0 ? (
                      <div className="mt-4 flex flex-col gap-2" data-testid="nearest-positions">
                        <p className="text-sm font-medium">What you could book today</p>
                        <ul className="flex flex-col gap-2 text-sm">
                          {missed.map((option) => (
                            <li key={option.label}>
                              <Link
                                href={hrefWith(params, {
                                  board: option.filters.board ?? null,
                                  level: option.filters.level ?? null,
                                  subject: option.filters.subject ?? null,
                                  exact: null,
                                })}
                                className="underline underline-offset-4"
                              >
                                {option.label}
                              </Link>{' '}
                              <span className="text-muted-foreground">
                                — {option.tutors} tutor{option.tutors === 1 ? '' : 's'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <CardDescription className="mt-4">
                      {first(params, 'exact') === '1' ? (
                        <>
                          You asked for an exact board and class match.{' '}
                          <Link
                            href={hrefWith(params, { exact: null })}
                            className="underline underline-offset-4"
                          >
                            Include tutors teaching the same class on other boards
                          </Link>
                          , or{' '}
                        </>
                      ) : null}
                      <Link
                        href={hrefWith(params, {
                          noCurriculum: '1',
                          board: null,
                          level: null,
                          subject: null,
                          exact: null,
                        })}
                        className="underline underline-offset-4"
                      >
                        see every tutor
                      </Link>
                      .
                    </CardDescription>
                  </>
                ) : (
                  <>
                    <CardTitle as="h3">No matches</CardTitle>
                    <CardDescription>
                      Nothing matched those filters.{' '}
                      <Link href="/" className="underline underline-offset-4">
                        Clear them and start again
                      </Link>
                      .
                    </CardDescription>
                  </>
                )}
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {grid.map((tutor) => (
                <TutorCard key={tutor.id} tutor={tutor} />
              ))}
            </div>
          )}

          {results.hasMore ? (
            <p className="text-sm text-muted-foreground">
              Showing the first {grid.length} of {results.total}. Narrow the filters to see the rest — infinite
              scroll lands with the rest of the feed work.
            </p>
          ) : null}
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <p>
            Credits never expire and are non-refundable to cash — refunds are returned as credits.{' '}
            <Link href="/signup" className="underline underline-offset-4">
              Create an account
            </Link>
          </p>
          {/* The policies have to be reachable from inside the product, not only
              from the marketing pages somebody may never see. */}
          <nav aria-label="Policies" className="flex flex-wrap gap-x-5 gap-y-2">
            {[
              ['How pricing works', '/pricing'],
              ['Become a tutor', '/teach'],
              ['Terms', '/terms'],
              ['Privacy', '/privacy'],
              ['Refunds', '/refund-policy'],
              ['Child safety', '/child-safety'],
            ].map(([label, href]) => (
              <Link key={href} href={href!} className="underline underline-offset-4">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </>
  );
}
