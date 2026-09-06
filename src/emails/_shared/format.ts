import type { LessonProps } from './types';

export function usd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Expected non-negative integer cents.');
  return `US$${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;
}
export function creditValue(cents: number): string { return `${usd(cents)} in lesson credits`; }
export function localTime(instant: string, timezone: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(instant)) throw new Error('Lesson time must include an explicit offset.');
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid lesson time.');
  if (!timezone.trim()) throw new Error('Recipient timezone is required.');
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' }).format(date)} (${timezone})`;
}
export function safeUrl(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Email links must be absolute HTTP(S) URLs without credentials.');
  return url.toString();
}
export function subjectLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}
export function lessonDetails(props: LessonProps): [string, string][] {
  if (!Number.isInteger(props.durationMinutes) || props.durationMinutes <= 0) throw new Error('Lesson duration must be a positive integer.');
  return [
    ['Booking', props.bookingId], ['With', props.counterpartName], ['Subject', props.subjectName],
    ['When', localTime(props.startsAt, props.timezone)], ['Duration', `${props.durationMinutes} minutes`],
  ];
}
