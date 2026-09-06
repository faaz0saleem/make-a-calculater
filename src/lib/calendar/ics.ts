/**
 * Calendar files and links (SPEC.md §7).
 *
 * A session in somebody's own calendar is worth more than every reminder this
 * product can send, because it is the thing they already look at. Reminders
 * are for the ten minutes before; the calendar entry is what stops the lesson
 * being forgotten on Tuesday morning.
 *
 * Pure: a session in, text out. No database, no clock beyond what is passed.
 *
 * The output is deliberately plain iCalendar. Every client parses it, none of
 * them need anything clever, and the fields that matter are the ones that make
 * an update land on the *same* entry rather than adding a second one — a stable
 * `UID` and a `SEQUENCE` that goes up when a session is moved.
 */

export type CalendarEvent = {
  /** Stable for the life of the booking, so a reschedule updates in place. */
  bookingId: string;
  title: string;
  description: string;
  startUtc: Date;
  endUtc: Date;
  /** Where the lesson happens. Always the in-app room. */
  url: string;
  /** Goes up every time the session moves; clients use it to accept an update. */
  sequence?: number;
  cancelled?: boolean;
  organiserName?: string;
};

/** `2026-09-15T13:00:00Z` -> `20260915T130000Z`. */
export function toIcsStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Escape a value for iCalendar.
 *
 * Commas, semicolons and backslashes are field separators there, so a chapter
 * called "Acids, bases and salts" would split one field into two without this.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a line to 75 octets, as the spec requires.
 *
 * Long descriptions are common — a chapter list plus a note — and an unfolded
 * line is the single most likely reason a real calendar client rejects a file.
 */
function fold(line: string): string {
  if (line.length <= 75) return line;

  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);

  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }

  if (rest.length > 0) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

/** One `.ics` file for one session. */
export function buildIcs(event: CalendarEvent, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tutorly//Sessions//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${event.cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    // Stable per booking, so a moved session replaces the old entry instead of
    // sitting beside it — the failure that makes people stop trusting these.
    `UID:booking-${event.bookingId}@tutorly`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `DTSTAMP:${toIcsStamp(now)}`,
    `DTSTART:${toIcsStamp(event.startUtc)}`,
    `DTEND:${toIcsStamp(event.endUtc)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `URL:${escapeText(event.url)}`,
    `LOCATION:${escapeText(event.url)}`,
    `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(event.organiserName
      ? [`ORGANIZER;CN=${escapeText(event.organiserName)}:mailto:noreply@tutorly.test`]
      : []),
    // A reminder inside the calendar itself, which fires even with the app
    // closed and the phone in a drawer.
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(event.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/**
 * A one-click "add to Google Calendar" link.
 *
 * Worth having beside the file: on a phone, an `.ics` download is several taps
 * and a "what do I open this with"; this is one tap and done.
 */
export function googleCalendarUrl(event: CalendarEvent): string {
  const parameters = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toIcsStamp(event.startUtc)}/${toIcsStamp(event.endUtc)}`,
    details: `${event.description}\n\n${event.url}`,
    location: event.url,
  });

  return `https://calendar.google.com/calendar/render?${parameters.toString()}`;
}
