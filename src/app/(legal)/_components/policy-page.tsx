import Link from 'next/link';
import { LEGAL_DRAFT_NOTICE, type LegalPolicy } from '../../../../content/legal';
import { PublicShell, textLink } from '../../(marketing)/_components/public-shell';

function anchor(heading: string) { return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''); }

export function PolicyPage({ policy }: { policy: LegalPolicy }) {
  return <PublicShell>
    <p className="rounded-lg border-2 border-warning bg-card px-5 py-4 text-base font-bold text-warning">{LEGAL_DRAFT_NOTICE}</p>
    <header className="mt-8 max-w-3xl"><h1 className="text-4xl font-semibold tracking-tight">{policy.title}</h1><p className="mt-4 text-lg leading-8">{policy.description}</p><p className="mt-3 text-sm">Draft prepared 5 September 2026. No effective date has been approved.</p></header>
    <aside aria-label="Unresolved legal review items" className="mt-7 rounded-xl border bg-card p-6">
      <h2 className="font-semibold">Before this policy can take effect</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 leading-7">{policy.reviewItems.map((item) => <li key={item}>{item}</li>)}</ul>
    </aside>
    <div className="mt-10 grid items-start gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="On this page" className="rounded-xl border p-5"><p className="mb-3 font-semibold">On this page</p><ol className="space-y-3 text-sm leading-6">{policy.sections.map((section) => <li key={section.heading}><a className={textLink} href={`#${anchor(section.heading)}`}>{section.heading}</a></li>)}</ol></nav>
      <div className="max-w-3xl space-y-10">{policy.sections.map((section) => <section key={section.heading} id={anchor(section.heading)} className="scroll-mt-6"><h2 className="text-2xl font-semibold">{section.heading}</h2><div className="mt-4 space-y-4 leading-8">{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></section>)}<p className="border-t pt-6 text-sm">Read alongside the <Link className={textLink} href="/terms">Terms</Link>, <Link className={textLink} href="/refund-policy">Refund Policy</Link> and <Link className={textLink} href="/child-safety">Child Safety Policy</Link>.</p></div>
    </div>
  </PublicShell>;
}
