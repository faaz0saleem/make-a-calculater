/**
 * The category row (SPEC.md §4).
 *
 * Plain links, so a category is a real URL a student can bookmark or share, and
 * the page works with JavaScript off.
 */

import Link from 'next/link';

import { cn } from '@/lib/utils';

export function CategoryChips({
  subjects,
  active,
  buildHref,
}: {
  subjects: { slug: string; name: string }[];
  active?: string;
  buildHref: (slug: string | undefined) => string;
}) {
  return (
    <nav aria-label="Subjects" className="-mx-6 overflow-x-auto px-6">
      <ul className="flex gap-2 pb-1">
        <li>
          <Link
            href={buildHref(undefined)}
            className={cn(
              'inline-block whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors',
              active ? 'border-border hover:bg-secondary' : 'border-transparent bg-primary text-primary-foreground',
            )}
          >
            All
          </Link>
        </li>
        {subjects.map((subject) => (
          <li key={subject.slug}>
            <Link
              href={buildHref(subject.slug)}
              aria-current={active === subject.slug ? 'page' : undefined}
              className={cn(
                'inline-block whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors',
                active === subject.slug
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border hover:bg-secondary',
              )}
            >
              {subject.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
