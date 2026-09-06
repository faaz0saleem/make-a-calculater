import { cache } from 'react';
import { getTutorCurriculum, listCurriculumOptions } from '@/db/curriculum';
import { listSubjects, searchTutors, type DiscoveryFilters, type FeedTutor } from '@/db/discovery';
import { ratingSummaryFor } from '@/db/reviews';
import { matchesLocation, matchingPositions, resolveCatalogue, type ResolvedIntent } from './catalogue';

/** Request memoization only: suspension and hidden reviews must take effect on the next request. */
export const getCatalogue = cache(async () => {
  const [boards, subjects] = await Promise.all([listCurriculumOptions(null), listSubjects()]);
  return { boards, pages: resolveCatalogue(boards, subjects) };
});

export type PublicTutor = {
  id: string;
  name: string;
  headline: string | null;
  city: string | null;
  country: string | null;
  hourlyCents: number;
  halfHourCents: number;
  offersTrial: boolean;
  positions: { boardName: string; levelName: string; subjectName: string }[];
  rating: { count: number; value: number | null };
};

const PAGE_SIZE = 60;
const DISPLAY_LIMIT = 12;

/** Always use the exported public query, including its verified/unsuspended visibility rule. */
export async function readMatchingTutors(intent: ResolvedIntent, boards: Awaited<ReturnType<typeof listCurriculumOptions>>): Promise<PublicTutor[]> {
  const filters: DiscoveryFilters = {
    subject: intent.subjectSlug,
    language: intent.language,
    country: intent.country,
    curriculum: {
      boardId: intent.boardId,
      levelId: intent.levelIds?.length === 1 ? intent.levelIds[0] : undefined,
      subjectId: intent.subjectId,
      includeNearMatches: false,
    },
    limit: PAGE_SIZE,
  };
  const matches: { tutor: FeedTutor; positions: ReturnType<typeof matchingPositions> }[] = [];
  let offset = 0;
  // City is not a query filter in the core. Page until enough exact matches are
  // found or inventory ends; never treat the first 60 candidates as all tutors.
  while (matches.length < DISPLAY_LIMIT) {
    const batch = await searchTutors({ ...filters, offset });
    const local = batch.tutors.filter((tutor) => matchesLocation(intent, tutor));
    const declared = await Promise.all(local.map(async (tutor) => ({
      tutor, positions: matchingPositions(intent, await getTutorCurriculum(tutor.id), boards),
    })));
    matches.push(...declared.filter((row) => row.positions.length > 0));
    if (!batch.hasMore || batch.tutors.length === 0) break;
    offset += batch.tutors.length;
  }
  return Promise.all(matches.slice(0, DISPLAY_LIMIT).map(async ({ tutor, positions }) => {
    const summary = await ratingSummaryFor(tutor.id);
    // Whitelist public fields; never serialize a dossier, credential or student identity.
    return {
      id: tutor.id, name: tutor.name, headline: tutor.headline,
      city: tutor.city, country: tutor.country,
      hourlyCents: tutor.hourlyCents, halfHourCents: tutor.halfHourCents,
      offersTrial: tutor.offersTrial,
      positions: positions.map(({ boardName, levelName, subjectName }) => ({ boardName, levelName, subjectName })),
      rating: { count: summary.count, value: summary.rawMilli === null ? null : summary.rawMilli / 1000 },
    };
  }));
}

export const getSeoPage = cache(async (slug: string) => {
  const catalogue = await getCatalogue();
  const intent = catalogue.pages.find((page) => page.slug === slug);
  if (!intent) return null;
  return { intent, tutors: await readMatchingTutors(intent, catalogue.boards),
    siblings: catalogue.pages.filter((page) => intent.siblings.includes(page.slug)) };
});
