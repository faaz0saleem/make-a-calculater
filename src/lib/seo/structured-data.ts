import type { PublicTutor } from './data';
import { absoluteUrl } from './site';

export function tutorStructuredData(tutors: readonly PublicTutor[]) {
  return {
    '@context': 'https://schema.org',
    '@graph': tutors.flatMap((tutor) => {
      const url = absoluteUrl(`/tutors/${encodeURIComponent(tutor.id)}`);
      const person = {
        '@type': 'Person', '@id': `${url}#person`, name: tutor.name, url,
        jobTitle: 'Online tutor',
        knowsAbout: [...new Set(tutor.positions.map((p) => `${p.boardName} ${p.levelName} ${p.subjectName}`))],
      };
      const rating = tutor.rating;
      // Person is the provider. AggregateRating belongs on the Service, where
      // schema.org permits it; never use the Bayesian prior as a real review.
      if (!Number.isInteger(rating.count) || rating.count <= 0 || rating.value === null
        || !Number.isFinite(rating.value) || rating.value < 1 || rating.value > 5) return [person];
      return [person, {
        '@type': 'Service', '@id': `${url}#tutoring`, name: `Online tutoring with ${tutor.name}`,
        url, provider: { '@id': `${url}#person` },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: rating.value, reviewCount: rating.count, bestRating: 5, worstRating: 1 },
      }];
    }),
  };
}

/** Defend a script element from names/headlines containing HTML delimiters. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
