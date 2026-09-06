/**
 * What a signed-out visitor may reach (SPEC.md §13.5).
 *
 * One list, read by the edge middleware. It is deliberately an allowlist rather
 * than a denylist: a new member page is private the moment somebody adds it,
 * and a new public page has to be named here on purpose. Getting that the wrong
 * way round is how a dashboard ends up indexed.
 *
 * The legal and editorial slugs are derived from the content modules rather
 * than copied, so adding a policy or a search page cannot silently produce a
 * page that redirects every anonymous visitor — the failure Codex hit and
 * stopped at rather than working around (CODEX_NOTES.md, boundary stop 1).
 */

import { LEGAL_POLICIES } from '../../../content/legal';
import { SEO_INTENTS } from '../../../content/seo-pages';

/** Anything under these is public. */
const PUBLIC_PREFIXES = [
  '/signin',
  '/signup',
  '/tutors',
  '/api/auth',
  '/api/health',
  // The unsubscribe link in an email has to work for somebody who is not
  // signed in on the device they read their mail on. The token is the
  // authorization; a session is not required and asking for one would make
  // the link useless (SPEC.md §11).
  '/unsubscribe',
] as const;

/** These exact paths, and nothing beneath them. */
const PUBLIC_EXACT = new Set<string>([
  '/',
  '/robots.txt',
  '/sitemap.xml',
  '/welcome',
  '/teach',
  '/pricing',
  ...LEGAL_POLICIES.map((policy) => `/${policy.slug}`),
  ...SEO_INTENTS.map((intent) => `/${intent.slug}`),
]);

export function isPublicPath(pathname: string): boolean {
  // Trailing slashes reach middleware as written, so `/pricing/` must not be
  // a private page while `/pricing` is public.
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
