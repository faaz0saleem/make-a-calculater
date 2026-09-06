import { getCatalogue, readMatchingTutors } from '@/lib/seo/data';
import { sitemapXml, STATIC_SITEMAP_PATHS } from '@/lib/seo/crawlers';
import { productionIndexingAllowed } from '@/lib/seo/site';
export const dynamic = 'force-dynamic';

export async function GET() {
  const paths: string[] = [];
  if (productionIndexingAllowed()) {
    const { boards, pages } = await getCatalogue();
    paths.push(...STATIC_SITEMAP_PATHS);
    // Same active catalogue and inventory check as metadata. Empty results,
    // draft policies, query variants and private routes are never advertised.
    for (const intent of pages) {
      if ((await readMatchingTutors(intent, boards)).length > 0) paths.push(`/${intent.slug}`);
    }
  }
  return new Response(sitemapXml(paths), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
}
