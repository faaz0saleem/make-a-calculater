import { defineEmail } from './_shared/email';
import { lessonDetails } from './_shared/format';
import type { OptionalEmailProps, LessonProps } from './_shared/types';
export type Reminder24hProps = OptionalEmailProps & LessonProps;
const Reminder24h = defineEmail<Reminder24hProps>('Reminder24h', (p) => ({
  subject: `Lesson reminder: ${p.subjectName} in about 24 hours`,
  preheader: 'Check the exact local time and prepare your lesson materials.', heading: 'Your lesson is coming up',
  paragraphs: ['Have your questions, notes and any attempted homework ready. The time below is shown in your timezone.', 'If your plans have changed, open the booking to check the current cancellation result. Exactly 24 hours falls in the half-refund tier; this reminder does not promise that a full refund is still available.'],
  details: lessonDetails(p), action: { label: 'Check your lesson', href: p.bookingUrl },
}));
export const plainText = Reminder24h.plainText;
export const subject = Reminder24h.subject;
export default Reminder24h;
