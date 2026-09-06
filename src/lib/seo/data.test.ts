import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/db/discovery', () => ({ searchTutors: vi.fn(), listSubjects: vi.fn() }));
vi.mock('@/db/curriculum', () => ({ getTutorCurriculum: vi.fn(), listCurriculumOptions: vi.fn() }));
vi.mock('@/db/reviews', () => ({ ratingSummaryFor: vi.fn() }));
import { searchTutors } from '@/db/discovery';
import { getTutorCurriculum } from '@/db/curriculum';
import { ratingSummaryFor } from '@/db/reviews';
import { readMatchingTutors } from './data';
import type { FeedTutor } from '@/db/discovery';
import type { BoardOption, CurriculumEntry } from '@/db/curriculum';
import type { ResolvedIntent } from './catalogue';

const boards: BoardOption[] = [{ id: 'caie', name: 'Cambridge', local: false, levels: [{ id: 'caie:o-level', boardId: 'caie', name: 'O Level', stage: 'upper_secondary' }] }];
const position: CurriculumEntry = { boardId: 'caie', boardName: 'Cambridge', levelId: 'caie:o-level', levelName: 'O Level', stage: 'upper_secondary', subjectId: 'chemistry-id', subjectName: 'Chemistry', subjectSlug: 'chemistry' };
const intent: ResolvedIntent = { slug: 'o-level-tutors-in-lahore', title: 'Lahore', description: 'O Level', boardId: 'caie', levelIds: ['caie:o-level'], city: 'Lahore', country: 'PK', paragraphs: [], questions: [], siblings: [], sources: [] };
function tutor(id: string, city = 'Lahore'): FeedTutor { return { id, city, name: 'Tutor', country: 'PK', headline: null, avatarUrl: null, timezone: 'Asia/Karachi', hourlyCents: 2500, halfHourCents: 1250, promoCents: null, offersTrial: true, trialMinutes: 15, ratingMilli: 4300, reviewCount: 0, sessionCount: 0, responseMedianSeconds: null, verifiedAt: new Date(), posterUrl: null, previewUrl: null, subjectNames: ['Chemistry'], matchTier: 0 }; }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getTutorCurriculum).mockResolvedValue([position]); vi.mocked(ratingSummaryFor).mockResolvedValue({ count: 0, rawMilli: null, displayedMilli: 4300, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, sharePercent: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }); });
describe('public query integration', () => {
  it('finds an actual city match beyond the first database page', async () => {
    vi.mocked(searchTutors).mockResolvedValueOnce({ tutors: Array.from({ length: 60 }, (_, i) => tutor(`other-${i}`, 'Karachi')), total: 61, hasMore: true }).mockResolvedValueOnce({ tutors: [tutor('lahore')], total: 61, hasMore: false });
    const rows = await readMatchingTutors(intent, boards);
    expect(rows.map((r) => r.id)).toEqual(['lahore']);
    expect(searchTutors).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 60, country: 'PK', curriculum: expect.objectContaining({ boardId: 'caie', levelId: 'caie:o-level', includeNearMatches: false }) }));
    expect(getTutorCurriculum).toHaveBeenCalledTimes(1);
    expect(rows[0]?.rating).toEqual({ count: 0, value: null });
  });
  it('does not use a general subject declaration as an exact curriculum match', async () => {
    vi.mocked(searchTutors).mockResolvedValue({ tutors: [tutor('wrong-level')], total: 1, hasMore: false });
    vi.mocked(getTutorCurriculum).mockResolvedValue([{ ...position, levelId: 'caie:igcse' }]);
    expect(await readMatchingTutors(intent, boards)).toEqual([]);
    expect(ratingSummaryFor).not.toHaveBeenCalled();
  });
  it('delegates Urdu filtering and requires the matching chemistry declaration', async () => {
    vi.mocked(searchTutors).mockResolvedValue({ tutors: [tutor('urdu')], total: 1, hasMore: false });
    await readMatchingTutors({ ...intent, city: undefined, boardId: undefined, levelIds: undefined, language: 'ur', subjectSlug: 'chemistry', subjectId: 'chemistry-id' }, boards);
    expect(searchTutors).toHaveBeenCalledWith(expect.objectContaining({ language: 'ur', subject: 'chemistry', curriculum: expect.objectContaining({ subjectId: 'chemistry-id', includeNearMatches: false }) }));
  });
  it('propagates database errors instead of inventing empty inventory', async () => {
    vi.mocked(searchTutors).mockRejectedValue(new Error('database offline'));
    await expect(readMatchingTutors(intent, boards)).rejects.toThrow('database offline');
  });
});
