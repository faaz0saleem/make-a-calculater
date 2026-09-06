import Link from 'next/link';
import { actionLink, textLink } from './public-shell';

/** Core owner: render above the existing feed only for a signed-out, unfiltered visit.
 * Defaults to h2 because the existing homepage already owns its h1.
 */
export function SignedOutIntro({ headingLevel = 2, browseHref = '#tutor-feed' }: { headingLevel?: 1 | 2; browseHref?: string }) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return <section aria-labelledby="welcome-heading" className="mb-12 grid gap-9 rounded-2xl border bg-card p-6 sm:p-10 lg:grid-cols-[1.35fr_1fr]">
    <div>
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">A clearer next lesson</p>
      <Heading id="welcome-heading" className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Find someone who teaches <span className="text-primary">your course.</span></Heading>
      <p className="mt-5 max-w-xl text-lg leading-8">Watch an introduction. Check their board, class and subject. Meet a tutor who can help you work through the part that hasn’t clicked yet.</p>
      <div className="mt-7 flex flex-wrap items-center gap-5"><a href={browseHref} className={actionLink}>Explore the tutors</a><Link href="/pricing" className={textLink}>Understand credits first</Link></div>
      <p className="mt-5 text-sm leading-6">Browse without an account. See the lesson price and choose a time before signing up to confirm.</p>
    </div>
    <ol className="space-y-5 self-center">
      {[
        ['01', 'Start with your syllabus', 'Board, class and subject make a better starting point than a star rating alone.'],
        ['02', 'Get a feel for the teaching', 'Read the profile and reviews. If a tutor offers a free trial, you can request one for their approval.'],
        ['03', 'Bring your own questions', 'Book 30 or 60 minutes and meet online. A worked attempt gives your tutor a useful place to begin.'],
      ].map(([number, title, copy]) => <li key={number} className="flex gap-4"><span aria-hidden="true" className="mt-1 font-mono text-sm font-semibold text-primary">{number}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6">{copy}</p></div></li>)}
    </ol>
  </section>;
}
