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
 */

import Link from 'next/link';
import { cookies } from 'next/headers';

import { CategoryChips } from '@/components/feed/category-chips';
import { Filters } from '@/components/feed/filters';
import { Rail } from '@/components/feed/rail';
import { TutorCard } from '@/components/feed/tutor-card';
import { SiteHeader } from '@/components/site-header';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  listSubjects,
  listTutorCountries,
  railAvailableSoon,
  railContinueWithYourTutors,
  railFreeTrials,
  railNewTutors,
  railTopRatedInSubject,
  searchTutors,
  SORT_OPTIONS,
  type DiscoveryFilters,
  type SortOption,
} from '@/db/discovery';
import { currentUser } from '@/lib/auth/guards';
import { toCardData } from '@/lib/tutors/card';
import { LAST_SUBJECT_COOKIE } from '@/middleware';

export const dynamic = 'force-dynamic';

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
    (filters.sort && filters.sort !== 'relevance')
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filters = parseFilters(params);

  const [viewer, jar, subjects, countries, results] = await Promise.all([
    currentUser(),
    cookies(),
    listSubjects(),
    listTutorCountries(),
    searchTutors(filters),
  ]);

  const timezone = viewer?.timezone ?? 'UTC';
  const browsing = isBrowsing(filters);
  const grid = await toCardData(results.tutors, timezone);

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

  const [continueRow, trialsRow, newRow, topRatedRow, availableRow] = browsing
    ? await Promise.all([
        viewer ? railContinueWithYourTutors(viewer.id) : Promise.resolve([]),
        railFreeTrials(),
        railNewTutors(),
        lastSubject ? railTopRatedInSubject(lastSubject) : Promise.resolve([]),
        railAvailableSoon(),
      ])
    : [[], [], [], [], null];

  const [continueCards, trialCards, newCards, topRatedCards] = await Promise.all([
    toCardData(continueRow, timezone),
    toCardData(trialsRow, timezone),
    toCardData(newRow, timezone),
    toCardData(topRatedRow, timezone),
  ]);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Find a tutor worth your hour</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Watch a minute of someone teaching before you book them. Every lesson is live, one to one, on
            video or voice — and most tutors will give you a free trial first.
          </p>
        </section>

        <CategoryChips subjects={subjects} active={filters.subject} buildHref={buildHref} />

        <Filters filters={filters} subjects={subjects} countries={countries} resultCount={results.total} />

        {browsing ? (
          <>
            {continueCards.length > 0 ? (
              <Rail
                title="Continue with your tutors"
                subtitle="People you have already had a session with."
                tutors={continueCards}
              />
            ) : null}

            <Rail
              title="Available in the next hour"
              pending={
                availableRow === null
                  ? 'This rail needs the booking calendar, which arrives in Phase 3. Rather than guess who is free, it stays empty.'
                  : undefined
              }
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

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight">
            {browsing ? 'All tutors' : `${results.total} result${results.total === 1 ? '' : 's'}`}
          </h2>

          {grid.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No matches</CardTitle>
                <CardDescription>
                  Nothing matched those filters.{' '}
                  <Link href="/" className="underline underline-offset-4">
                    Clear them and start again
                  </Link>
                  .
                </CardDescription>
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
