/**
 * Getting a lesson into the calendar somebody already looks at (SPEC.md §7).
 *
 * Two links because two habits: a `.ics` download for a desktop client, and a
 * one-tap Google link for a phone, where a downloaded file is several taps and
 * a "what do I open this with".
 *
 * Worth more than every reminder in this product put together. A reminder
 * competes with every other notification on a phone; a calendar entry is in the
 * thing they check to find out what their day is.
 */

import { googleCalendarUrl } from '@/lib/calendar/ics';

export function AddToCalendar({
  bookingId,
  title,
  description,
  startUtc,
  endUtc,
  baseUrl,
}: {
  bookingId: string;
  title: string;
  description: string;
  startUtc: Date;
  endUtc: Date;
  baseUrl: string;
}) {
  const google = googleCalendarUrl({
    bookingId,
    title,
    description,
    startUtc,
    endUtc,
    url: `${baseUrl}/sessions/${bookingId}`,
  });

  return (
    <span className="flex flex-wrap items-center gap-3 text-xs" data-testid="add-to-calendar">
      <a
        href={`/api/bookings/${bookingId}/calendar`}
        className="underline underline-offset-4"
        data-testid="ics-link"
      >
        Add to calendar
      </a>
      <a
        href={google}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-4 text-muted-foreground"
        data-testid="google-link"
      >
        Google Calendar
      </a>
    </span>
  );
}
