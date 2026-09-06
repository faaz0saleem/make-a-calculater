import { describe, expect, it, afterEach, vi } from 'vitest';
import { SEO_INTENTS } from '../../../content/seo-pages';
import { LEGAL_POLICIES, LEGAL_DRAFT_NOTICE } from '../../../content/legal';
import { matchingPositions, matchesLocation, resolveCatalogue } from './catalogue';
import { serializeJsonLd, tutorStructuredData } from './structured-data';
import { absoluteUrl, hasQueryParameters, pageMetadata, productionIndexingAllowed } from './site';
import { robotsText, sitemapXml } from './crawlers';
import type { PublicTutor } from './data';
import type { BoardOption, CurriculumEntry } from '@/db/curriculum';

const boards: BoardOption[] = [{ id: 'caie', name: 'Cambridge', local: false, levels: [
  { id: 'caie:as-level', boardId: 'caie', name: 'AS Level', stage: 'advanced_1' },
  { id: 'caie:a2-level', boardId: 'caie', name: 'A2 Level', stage: 'advanced_2' },
  { id: 'caie:o-level', boardId: 'caie', name: 'O Level', stage: 'upper_secondary' },
]}];
const subjects = [{ id: 'physics-id', slug: 'physics', name: 'Physics' }, { id: 'chemistry-id', slug: 'chemistry', name: 'Chemistry' }];
const entry: CurriculumEntry = { boardId: 'caie', boardName: 'Cambridge', levelId: 'caie:as-level', levelName: 'AS Level', stage: 'advanced_1', subjectId: 'physics-id', subjectSlug: 'physics', subjectName: 'Physics' };
const tutor: PublicTutor = { id: 'tutor-id', name: '</script><script>alert(1)</script>', headline: null, city: 'Lahore', country: 'PK', hourlyCents: 2500, halfHourCents: 1250, offersTrial: false, positions: [entry], rating: { count: 0, value: null } };

afterEach(() => vi.unstubAllEnvs());
describe('curriculum-backed editorial routes', () => {
  it('never publishes a page just because its copy exists', () => {
    expect(resolveCatalogue([], subjects)).toEqual([]);
    const pages = resolveCatalogue(boards, subjects);
    expect(pages.some((p) => p.slug === 'caie-a-level-physics-tutors')).toBe(true);
    expect(pages.some((p) => p.slug === 'edexcel-igcse-maths-tutors')).toBe(false);
    expect(resolveCatalogue(boards, []).some((p) => p.subjectSlug)).toBe(false);
  });
  it('requires the exact declared subject and stage on the requested board', () => {
    const intent = resolveCatalogue(boards, subjects).find((p) => p.slug === 'caie-as-level-physics-tutors')!;
    expect(matchingPositions(intent, [entry, { ...entry, levelId: 'caie:a2-level' }, { ...entry, subjectId: 'chemistry-id' }, { ...entry, boardId: 'edexcel' }], boards)).toEqual([entry]);
    expect(matchingPositions(intent, [entry], [])).toEqual([]);
  });
  it('does not treat Pakistan or a biography mentioning Lahore as a Lahore location', () => {
    const intent = resolveCatalogue(boards, subjects).find((p) => p.city)!;
    expect(matchesLocation(intent, { city: ' lahore ', country: 'PK' })).toBe(true);
    expect(matchesLocation(intent, { city: 'Karachi', country: 'PK' })).toBe(false);
    expect(matchesLocation(intent, { city: 'Lahore', country: 'US' })).toBe(false);
  });
  it('has substantial distinct copy, unique titles, and valid sibling links', () => {
    const slugs = SEO_INTENTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(SEO_INTENTS.length);
    expect(new Set(SEO_INTENTS.map((p) => p.title)).size).toBe(SEO_INTENTS.length);
    expect(new Set(SEO_INTENTS.map((p) => p.description)).size).toBe(SEO_INTENTS.length);
    for (const page of SEO_INTENTS) {
      expect(page.paragraphs.join(' ').split(/\s+/).length).toBeGreaterThanOrEqual(150);
      expect(page.questions.length).toBeGreaterThanOrEqual(3);
      for (const sibling of page.siblings) { expect(slugs).toContain(sibling); expect(sibling).not.toBe(page.slug); }
    }
    expect(LEGAL_POLICIES).toHaveLength(5);
    expect(LEGAL_DRAFT_NOTICE).toBe('DRAFT — REQUIRES LEGAL REVIEW');
  });
});
describe('honest and safe structured data', () => {
  it('omits a rating for an unreviewed tutor instead of using a Bayesian prior', () => {
    expect(JSON.stringify(tutorStructuredData([tutor]))).not.toContain('AggregateRating');
    expect(JSON.stringify(tutorStructuredData([tutor]))).toContain('Person');
  });
  it('uses only real public review counts and the supplied unadjusted mean', () => {
    const data = tutorStructuredData([{ ...tutor, rating: { count: 3, value: 4.333 } }]);
    const service = data['@graph'].find((row) => row['@type'] === 'Service');
    expect(service).toMatchObject({ aggregateRating: { ratingValue: 4.333, reviewCount: 3 } });
    expect(data['@graph'].find((row) => row['@type'] === 'Person')).not.toHaveProperty('aggregateRating');
  });
  it.each([NaN, Infinity, 0, 6])('does not emit an invalid aggregate %s', (value) => {
    expect(JSON.stringify(tutorStructuredData([{ ...tutor, rating: { count: 4, value } }]))).not.toContain('AggregateRating');
  });
  it('escapes script delimiters without corrupting JSON or adding private fields', () => {
    const data = tutorStructuredData([tutor]);
    const json = serializeJsonLd(data);
    expect(json).not.toContain('</script>');
    expect(JSON.parse(json)).toEqual(data);
    expect(json).not.toMatch(/studentId|studentName|credentials|fileKey|email|bank/);
  });
});
describe('canonical URLs and crawler responses', () => {
  it('removes every filter, fragment and duplicate sitemap URL', () => {
    vi.stubEnv('AUTH_URL', 'https://lessons.example.org');
    expect(absoluteUrl('/caie-a-level-physics-tutors?sort=rating&language=ur#faq')).toBe('https://lessons.example.org/caie-a-level-physics-tutors');
    expect(sitemapXml(['/teach', '/teach?utm_source=test']).match(/<loc>/g)).toHaveLength(1);
    expect(() => absoluteUrl('//external.example/')).toThrow();
  });
  it('keeps preview environments out of the index', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('AUTH_URL', 'https://lessons.example.org'); vi.stubEnv('VERCEL_ENV', 'preview');
    expect(productionIndexingAllowed()).toBe(false);
    expect(robotsText()).toBe('User-agent: *\nDisallow: /\n');
  });
  it('allows crawlers to read noindex on query variants rather than blocking it', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('AUTH_URL', 'https://lessons.example.org'); vi.stubEnv('VERCEL_ENV', 'production');
    expect(hasQueryParameters({ sort: '' })).toBe(true);
    const metadata = pageMetadata('Physics', 'Course', '/caie-a-level-physics-tutors', !hasQueryParameters({ sort: 'rating' }));
    expect(metadata.robots).toMatchObject({ index: false });
    expect(metadata.alternates?.canonical).toBe('https://lessons.example.org/caie-a-level-physics-tutors');
    expect(robotsText()).not.toContain('Disallow: /*?');
    expect(robotsText()).toContain('Sitemap: https://lessons.example.org/sitemap.xml');
  });
});
