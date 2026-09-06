import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SEO_INTENTS } from '../../../../content/seo-pages';
import { getSeoPage } from '@/lib/seo/data';
import { discoveryHref } from '@/lib/seo/catalogue';
import { hasQueryParameters, pageMetadata, type QueryParameters } from '@/lib/seo/site';
import { serializeJsonLd, tutorStructuredData } from '@/lib/seo/structured-data';
import { PublicShell, actionLink, textLink } from '../../(marketing)/_components/public-shell';
import { TutorResults } from '../_components/tutor-results';

// Fresh tutor visibility/reviews and noindex on URL variants require request
// rendering. Editorial and legal/marketing pages stay static where possible.
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ tutorSearch: string }>; searchParams: Promise<QueryParameters> };

async function load(slug: string) {
  if (!SEO_INTENTS.some((intent) => intent.slug === slug)) notFound();
  const page = await getSeoPage(slug);
  if (!page) notFound();
  return page;
}

export async function generateMetadata({ params, searchParams }: Props) {
  const [{ tutorSearch }, query] = await Promise.all([params, searchParams]);
  const { intent, tutors } = await load(tutorSearch);
  return pageMetadata(intent.title, intent.description, `/${intent.slug}`, tutors.length > 0 && !hasQueryParameters(query));
}

export default async function TutorSearchPage({ params }: Props) {
  const { tutorSearch } = await params;
  const { intent, tutors, siblings } = await load(tutorSearch);
  return <PublicShell>
    <nav aria-label="Breadcrumb" className="mb-6 text-sm"><Link className={textLink} href="/">Find a tutor</Link><span aria-hidden="true"> / </span><span>{intent.title}</span></nav>
    <div className="max-w-3xl">
      <p className="font-semibold text-primary">Your curriculum. Your next step.</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{intent.title}</h1>
      <p className="mt-5 text-lg leading-8">{intent.description}</p>
      <a href="#matching-tutors" className={`${actionLink} mt-6`}>See matching tutors</a>
    </div>
    <section className="mt-12 max-w-3xl" aria-labelledby="lesson-guide">
      <h2 id="lesson-guide" className="text-2xl font-semibold">Plan a lesson that fits this course</h2>
      <div className="mt-5 space-y-5 leading-8">{intent.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      {intent.sources.length > 0 && <ul className="mt-5 space-y-2 text-sm">{intent.sources.map((source) => <li key={source.url}><a className={textLink} href={source.url}>{source.label}</a></li>)}</ul>}
    </section>
    <section id="matching-tutors" className="mt-14 scroll-mt-6" aria-labelledby="matching-heading">
      <h2 id="matching-heading" className="mb-3 text-2xl font-semibold">Matching tutors</h2>
      <p className="mb-6 max-w-3xl text-sm leading-6">{tutors.length > 0 ? `Showing ${tutors.length} matching ${tutors.length === 1 ? 'tutor' : 'tutors'}. ` : ''}Credential review does not guarantee teaching quality or grades. Ratings below are the unadjusted average of visible reviews; the main feed uses an adjusted ranking score.</p>
      <TutorResults tutors={tutors} />
      <Link href={discoveryHref(intent)} className={`${textLink} mt-6 inline-block text-sm`}>Explore more tutors in the discovery feed</Link>
      {intent.city && <p className="mt-2 text-xs leading-5">The full feed can filter by country, but it does not currently have a city filter.</p>}
    </section>
    <section className="mt-14 max-w-3xl" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-2xl font-semibold">Questions about these lessons</h2>
      <div className="mt-5 divide-y rounded-xl border px-5">{intent.questions.map((faq) => <details key={faq.question} className="py-5"><summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">{faq.question}</summary><p className="mt-3 leading-7">{faq.answer}</p></details>)}</div>
    </section>
    <section className="mt-14" aria-labelledby="related-heading">
      <h2 id="related-heading" className="text-2xl font-semibold">Related searches</h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">{siblings.map((sibling) => <li key={sibling.slug}><Link className={`${textLink} block rounded-lg border p-4`} href={`/${sibling.slug}`}>{sibling.title}</Link></li>)}</ul>
    </section>
    {tutors.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(tutorStructuredData(tutors)) }} />}
  </PublicShell>;
}
