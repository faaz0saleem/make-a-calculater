import { defineEmail } from './_shared/email';
import { lessonDetails } from './_shared/format';
import type { OptionalEmailProps, LessonProps } from './_shared/types';
export type Reminder1hProps = OptionalEmailProps & LessonProps;
const Reminder1h = defineEmail<Reminder1hProps>('Reminder1h', (p) => ({
  subject: `Your ${p.subjectName} lesson is in about one hour`,
  preheader: 'Set up your microphone, connection and lesson notes.', heading: 'Nearly time for your lesson',
  paragraphs: ['Check your microphone and connection, and have your work ready before the scheduled start. If you are a student under 18, make sure your guardian knows about the lesson.', 'The room opens five minutes before the scheduled start. Open your booking for the exact time and joining instructions.'],
  details: lessonDetails(p), action: { label: 'Open your booking', href: p.bookingUrl },
}));
export const plainText = Reminder1h.plainText;
export const subject = Reminder1h.subject;
export default Reminder1h;
