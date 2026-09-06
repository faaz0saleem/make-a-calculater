import { absoluteUrl, productionIndexingAllowed } from './site';

export const STATIC_SITEMAP_PATHS = ['/', '/teach', '/pricing'] as const;
export function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
export function sitemapXml(paths: readonly string[]): string {
  const urls = [...new Set(paths.map(absoluteUrl))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export function robotsText(): string {
  if (!productionIndexingAllowed()) return 'User-agent: *\nDisallow: /\n';
  // Do not disallow query variants: crawlers must be able to read noindex and
  // the canonical on our new SEO pages. Robots is never an authorization gate.
  return [
    'User-agent: *', 'Allow: /',
    ...['/admin/', '/api/', '/dashboard', '/credits', '/sessions/', '/messages', '/notifications', '/settings/', '/tutor/', '/signin', '/signup', '/welcome'].map((path) => `Disallow: ${path}`),
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`, '',
  ].join('\n');
}
