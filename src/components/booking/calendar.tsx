/**
 * The booking calendar (SPEC.md §5).
 *
 * Slots are rendered in the *student's* timezone, with the tutor's local time
 * underneath — so nobody has to do the arithmetic, and the two of them can see
 * they mean the same moment. Days are grouped by the student's calendar day,
 * because that is the one they are planning around.
 *
 * Booking itself is checkpoint B; the slots here are read-only for now.
 */

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { formatCents } from '@/lib/money/cents';
import { formatClock, formatInTimeZone, getLocalParts } from '@/lib/time';
import { cn } from '@/lib/utils';

export type CalendarSlot = {
  startUtc: Date;
  durationMinutes: number;
};

export type CalendarProps = {
  slots: CalendarSlot[] | null;
  studentTimezone: string;
  tutorTimezone: string;
  durationMinutes: 30 | 60;
  priceCents: number;
  /** Links back to this page with the other duration selected. */
  durationHref: (minutes: 30 | 60) => string;
  bookable: boolean;
  notBookableReason?: string;
};

type Day = { key: string; label: string; slots: CalendarSlot[] };

function groupByStudentDay(slots: CalendarSlot[], timezone: string): Day[] {
  const days = new Map<string, Day>();

  for (const slot of slots) {
    const parts = getLocalParts(slot.startUtc, timezone);
    const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

    let day = days.get(key);
    if (!day) {
      day = {
        key,
        label: formatInTimeZone(slot.startUtc, timezone, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        }),
        slots: [],
      };
      days.set(key, day);
    }
    day.slots.push(slot);
  }

  return [...days.values()];
}

export function BookingCalendar({
  slots,
  studentTimezone,
  tutorTimezone,
  durationMinutes,
  priceCents,
  durationHref,
  bookable,
  notBookableReason,
}: CalendarProps) {
  const sameZone = studentTimezone === tutorTimezone;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="calendar-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="calendar-heading" className="text-lg font-semibold tracking-tight">
            Book a session
          </h2>
          <p className="text-sm text-muted-foreground">
            Times shown in <strong>{studentTimezone}</strong>
            {sameZone ? null : <> — the tutor&rsquo;s local time is underneath each slot.</>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {([30, 60] as const).map((minutes) => (
            <Link
              key={minutes}
              href={durationHref(minutes)}
              aria-current={minutes === durationMinutes ? 'true' : undefined}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                minutes === durationMinutes
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border hover:bg-secondary',
              )}
            >
              {minutes} min
            </Link>
          ))}
          <Badge variant="secondary">{formatCents(priceCents)}</Badge>
        </div>
      </div>

      {!bookable ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {notBookableReason ?? 'This tutor is not taking bookings.'}
        </p>
      ) : slots === null ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          This tutor has not published any hours yet.
        </p>
      ) : slots.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Nothing free in the next few weeks for a {durationMinutes}-minute session.
          {durationMinutes === 60 ? ' A 30-minute session may still fit.' : ''}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groupByStudentDay(slots, studentTimezone).map((day) => (
            <div key={day.key} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{day.label}</h3>
              <ul className="flex flex-wrap gap-2">
                {day.slots.map((slot) => (
                  <li key={slot.startUtc.toISOString()}>
                    <span
                      data-testid="calendar-slot"
                      data-start={slot.startUtc.toISOString()}
                      className="flex min-w-20 flex-col items-center rounded-md border border-border px-3 py-1.5 text-sm"
                    >
                      <span className="font-medium tabular-nums">
                        {formatClock(slot.startUtc, studentTimezone)}
                      </span>
                      {sameZone ? null : (
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {formatClock(slot.startUtc, tutorTimezone)} for them
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Choosing a slot and paying with credits arrives with booking. The calendar above is live: it already
        subtracts existing sessions, the tutor&rsquo;s buffer between them, their daily cap, and any time they
        have blocked off.
      </p>
    </section>
  );
}
