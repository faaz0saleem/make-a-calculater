/**
 * The booking calendar (SPEC.md §5).
 *
 * Slots are rendered in the *student's* timezone, with the tutor's local time
 * underneath — so nobody has to do the arithmetic, and the two of them can see
 * they mean the same moment. Days are grouped by the student's calendar day,
 * because that is the one they are planning around.
 *
 * Slots are read-only unless the page hands in a `select` action — which today
 * is the free-trial request (SPEC.md §6). Paying for a session with credits is
 * checkpoint B of phase 3 and is still owed.
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

export type CalendarMode = 30 | 60 | 'trial';

export type CalendarProps = {
  slots: CalendarSlot[] | null;
  studentTimezone: string;
  tutorTimezone: string;
  mode: CalendarMode;
  /** What the chosen mode costs. Zero for a trial. */
  priceCents: number;
  /** How long the chosen mode runs for. */
  durationMinutes: number;
  /** Links back to this page with another mode selected. */
  modeHref: (mode: CalendarMode) => string;
  /** Offered as a chip when the tutor has trials on and this student may take one. */
  trialMinutes: number | null;
  bookable: boolean;
  notBookableReason?: string;
  /**
   * Makes each slot a button. Given only when the viewer can actually act on
   * it — a signed-out visitor gets the same calendar, read-only, rather than a
   * button that turns into a sign-in wall.
   */
  select?: {
    action: (formData: FormData) => void | Promise<void>;
    label: string;
    note: string;
  };
  /** Shown above the grid when the last attempt failed. */
  error?: string | null;
};

type Day = { key: string; label: string; slots: CalendarSlot[] };

/**
 * How many days are open before the rest fold away.
 *
 * The calendar publishes four weeks. Rendered flat, at every half hour, that is
 * roughly 2,500px of buttons on a 360px phone — so a tutor's reviews, their bio
 * and their credentials all sit below a wall of times nobody scrolls past. Two
 * days is what somebody booking this week actually reads; the rest is one tap
 * away and the summary says exactly how much is behind it.
 *
 * A `details` element rather than component state: it works with JavaScript
 * off, the keyboard already knows how to open it, and there is nothing to get
 * wrong.
 */
const OPEN_DAYS = 2;

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
  mode,
  priceCents,
  durationMinutes,
  modeHref,
  trialMinutes,
  bookable,
  notBookableReason,
  select,
  error,
}: CalendarProps) {
  const sameZone = studentTimezone === tutorTimezone;
  const modes: CalendarMode[] = trialMinutes ? ['trial', 30, 60] : [30, 60];

  const days = groupByStudentDay(slots ?? [], studentTimezone);
  const openDays = days.slice(0, OPEN_DAYS);
  const laterDays = days.slice(OPEN_DAYS);
  const laterSlotCount = laterDays.reduce((total, day) => total + day.slots.length, 0);

  const renderDay = (day: Day) => (
    <div key={day.key} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{day.label}</h3>
      <ul className="flex flex-wrap gap-2">
        {day.slots.map((slot) => {
          const time = formatClock(slot.startUtc, studentTimezone);
          const theirTime = sameZone ? null : (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {formatClock(slot.startUtc, tutorTimezone)} for them
            </span>
          );

          return (
            <li key={slot.startUtc.toISOString()}>
              {select ? (
                <form action={select.action}>
                  <input type="hidden" name="startUtc" value={slot.startUtc.toISOString()} />
                  <button
                    type="submit"
                    data-testid="calendar-slot"
                    data-start={slot.startUtc.toISOString()}
                    aria-label={`${select.label} at ${time}`}
                    className="flex min-h-11 min-w-20 flex-col items-center justify-center rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="font-medium tabular-nums">{time}</span>
                    {theirTime}
                  </button>
                </form>
              ) : (
                <span
                  data-testid="calendar-slot"
                  data-start={slot.startUtc.toISOString()}
                  className="flex min-w-20 flex-col items-center rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  <span className="font-medium tabular-nums">{time}</span>
                  {theirTime}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <section className="flex flex-col gap-4" aria-labelledby="calendar-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="calendar-heading" className="text-lg font-semibold tracking-tight">
            {mode === 'trial' ? 'Book your free trial' : 'Book a session'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Times shown in <strong>{studentTimezone}</strong>
            {sameZone ? null : <> — the tutor&rsquo;s local time is underneath each slot.</>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {modes.map((option) => (
            <Link
              key={String(option)}
              href={modeHref(option)}
              aria-current={option === mode ? 'true' : undefined}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                option === mode
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border hover:bg-secondary',
              )}
            >
              {option === 'trial' ? `Free trial · ${trialMinutes} min` : `${option} min`}
            </Link>
          ))}
          <Badge variant={mode === 'trial' ? 'success' : 'secondary'}>
            {mode === 'trial' ? 'Free' : formatCents(priceCents)}
          </Badge>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

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
          {mode === 60 ? ' A 30-minute session may still fit.' : ''}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {openDays.map(renderDay)}

          {laterDays.length > 0 ? (
            <details className="rounded-lg border border-border" data-testid="more-days">
              <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm marker:content-none hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="font-medium underline underline-offset-4">
                  {laterDays.length} more {laterDays.length === 1 ? 'day' : 'days'}
                </span>
                <span className="ml-2 text-muted-foreground">
                  · {laterSlotCount} more {laterSlotCount === 1 ? 'time' : 'times'}, to{' '}
                  {laterDays[laterDays.length - 1]!.label}
                </span>
              </summary>
              <div className="flex flex-col gap-4 px-4 pb-4">{laterDays.map(renderDay)}</div>
            </details>
          ) : null}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {select
          ? select.note
          : 'Choosing a slot and paying with credits arrives with booking.'}{' '}
        The calendar above is live: it already subtracts existing sessions, the tutor&rsquo;s buffer between
        them, their daily cap, and any time they have blocked off.
      </p>
    </section>
  );
}
