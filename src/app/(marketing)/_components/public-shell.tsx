import Link from 'next/link';
import type { ReactNode } from 'react';

export const textLink = 'underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring';
export const actionLink = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring';

export function PublicShell({ children }: { children: ReactNode }) {
  return <>
    <a href="#main-content" className="sr-only focus:not-sr-only focus:block focus:p-4">Skip to content</a>
    <header className="border-b bg-card">
      <nav aria-label="Main navigation" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/" className={`text-xl font-bold tracking-tight ${textLink}`}>Tutorly<span className="text-primary">.</span></Link>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-medium">
          <Link href="/" className={textLink}>Find a tutor</Link>
          <Link href="/pricing" className={textLink}>How pricing works</Link>
          <Link href="/teach" className={textLink}>Become a tutor</Link>
          <Link href="/signin" className={textLink}>Sign in</Link>
        </div>
      </nav>
    </header>
    <main id="main-content" className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-16">{children}</main>
    <footer className="border-t bg-card">
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-9 text-sm sm:grid-cols-2 sm:px-8">
        <p className="max-w-sm leading-6">Lessons with people who teach your curriculum. Meet online, compare the fit, and learn at your own pace.</p>
        <nav aria-label="Policies" className="flex flex-wrap gap-x-5 gap-y-3 sm:justify-end">
          {[["Terms", "/terms"], ["Privacy", "/privacy"], ["Refunds", "/refund-policy"], ["Tutor agreement", "/tutor-agreement"], ["Child safety", "/child-safety"]].map(([label, href]) => <Link key={href} href={href!} className={textLink}>{label}</Link>)}
        </nav>
      </div>
    </footer>
  </>;
}
