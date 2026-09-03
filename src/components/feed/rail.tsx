/**
 * A horizontally scrolling rail of tutor cards (SPEC.md §4).
 *
 * `pending` is for a rail that cannot be built yet — "Available in the next
 * hour" needs the availability engine from Phase 3. It renders the heading and
 * an honest line rather than a plausible-looking list.
 */

import { TutorCard, type TutorCardData } from './tutor-card';

export function Rail({
  title,
  subtitle,
  tutors,
  pending,
}: {
  title: string;
  subtitle?: string;
  tutors?: TutorCardData[];
  pending?: string;
}) {
  if (!pending && (!tutors || tutors.length === 0)) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`rail-${title.replace(/\W+/g, '-')}`}>
      <div>
        <h2 id={`rail-${title.replace(/\W+/g, '-')}`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>

      {pending ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {pending}
        </p>
      ) : (
        <div className="-mx-6 overflow-x-auto px-6 pb-2">
          <div className="flex gap-4">
            {tutors!.map((tutor) => (
              <TutorCard key={tutor.id} tutor={tutor} className="w-64 shrink-0" />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
