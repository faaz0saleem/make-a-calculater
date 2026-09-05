/**
 * The moment after a free trial ends (SPEC.md §6).
 *
 * "Book a full session with {tutor}", with the next three genuinely free slots
 * already on screen — from the Phase 3 availability engine, not a placeholder.
 * The spec asks for this to be the loudest thing on the page, so it is: it sits
 * above everything else, it is the only primary action, and the slots are one
 * press away rather than behind a calendar.
 *
 * Deliberately free of server-only imports, so the classroom (a client
 * component) and the dashboard (a server one) can both render it.
 */

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money/cents';

export type ConversionSlot = {
  /** ISO instant, so this survives the server-to-client boundary. */
  startUtcIso: string;
  /** Preformatted on the server, in the student's timezone. */
  label: string;
};

export type TrialConversionProps = {
  tutorId: string;
  tutorName: string;
  hourlyCents: number;
  halfHourCents: number;
  slots: ConversionSlot[];
};

export function TrialConversion({
  tutorId,
  tutorName,
  hourlyCents,
  halfHourCents,
  slots,
}: TrialConversionProps) {
  const firstName = tutorName.split(' ')[0] ?? tutorName;

  return (
    <section
      aria-labelledby="conversion-heading"
      data-testid="trial-conversion"
      className="rounded-lg border-2 border-primary bg-card p-5"
    >
      <h2 id="conversion-heading" className="text-xl font-semibold tracking-tight">
        Book a full session with {firstName}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatCents(hourlyCents)} an hour, or {formatCents(halfHourCents)} for 30 minutes. Your free trial
        is used up, but a full session picks up where you left off.
      </p>

      {slots.length > 0 ? (
        <>
          <p className="mt-4 text-sm font-medium">Their next free times</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {slots.map((slot) => (
              <li key={slot.startUtcIso}>
                <Link
                  href={`/tutors/${tutorId}?mode=60&at=${encodeURIComponent(slot.startUtcIso)}`}
                  data-testid="conversion-slot"
                  className="flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-sm font-medium hover:border-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {slot.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {firstName} has nothing free in the next fortnight. Following them means you hear as soon as that
          changes.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link href={`/tutors/${tutorId}?mode=60`}>
          <Button size="lg" className="min-h-11">
            See {firstName}&rsquo;s full calendar
          </Button>
        </Link>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Paying for a session with credits is not switched on yet, so this opens their calendar rather than
        taking payment.
      </p>
    </section>
  );
}
