import type { BoardOption, CurriculumEntry } from '@/db/curriculum';
import type { FeedTutor } from '@/db/discovery';
import { SEO_INTENTS, type SeoIntent } from '../../../content/seo-pages';

export type SubjectOption = { id: string; slug: string; name: string };
export type ResolvedIntent = SeoIntent & { subjectId?: string };

/** Active database rows authorize publication; copy alone never invents a curriculum. */
export function resolveCatalogue(boards: readonly BoardOption[], subjects: readonly SubjectOption[]): ResolvedIntent[] {
  return (SEO_INTENTS as readonly SeoIntent[]).flatMap((intent) => {
    const subject = intent.subjectSlug ? subjects.find((s) => s.slug === intent.subjectSlug) : undefined;
    if (intent.subjectSlug && !subject) return [];
    const board = intent.boardId ? boards.find((b) => b.id === intent.boardId) : undefined;
    if (intent.boardId && !board) return [];
    if (intent.levelIds?.some((id) => !board?.levels.some((level) => level.id === id))) return [];
    if (!boards.some((b) => b.levels.length > 0)) return [];
    return [{ ...intent, subjectId: subject?.id }];
  });
}

export function matchingPositions(intent: ResolvedIntent, entries: readonly CurriculumEntry[], boards: readonly BoardOption[]): CurriculumEntry[] {
  return entries.filter((entry) =>
    boards.some((board) => board.id === entry.boardId && board.levels.some((level) => level.id === entry.levelId))
    && (!intent.boardId || entry.boardId === intent.boardId)
    && (!intent.levelIds || intent.levelIds.includes(entry.levelId))
    && (!intent.subjectId || entry.subjectId === intent.subjectId));
}

export function matchesLocation(intent: ResolvedIntent, tutor: Pick<FeedTutor, 'city' | 'country'>): boolean {
  return (!intent.country || tutor.country === intent.country)
    && (!intent.city || tutor.city?.trim().toLocaleLowerCase('en') === intent.city.toLocaleLowerCase('en'));
}

export function discoveryHref(intent: ResolvedIntent): string {
  const query = new URLSearchParams();
  if (intent.subjectSlug) query.set('subject', intent.subjectSlug);
  if (intent.boardId) query.set('board', intent.boardId);
  if (intent.levelIds?.length === 1) query.set('level', intent.levelIds[0]!);
  if (intent.language) query.set('language', intent.language);
  if (intent.country) query.set('country', intent.country);
  query.set('exact', '1');
  return `/?${query.toString()}`;
}
