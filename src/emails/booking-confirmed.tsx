import { defineEmail } from './_shared/email';
import { creditValue, lessonDetails } from './_shared/format';
import type { EmailBaseProps, LessonProps } from './_shared/types';

export type BookingConfirmedProps = EmailBaseProps & LessonProps & {
  recipientRole: 'student' | 'tutor';
  isTrial: boolean;
  priceCents: number;
  /** True only when the sending adapter actually attaches the calendar file. */
  calendarAttached?: boolean;
};
const BookingConfirmed = defineEmail<BookingConfirmedProps>('BookingConfirmed', (p) => ({
  subject: `Booking confirmed with ${p.counterpartName}`,
  preheader: 'Your lesson time is confirmed. Check the details in your timezone.',
  heading: p.isTrial ? 'Your free trial is confirmed' : 'Your lesson is confirmed',
  paragraphs: [
    p.recipientRole === 'student' ? 'Your tutor is expecting you. Open your booking to review the time and prepare your questions.' : 'Your student has a confirmed lesson with you. Open the booking to prepare for the session.',
    p.isTrial ? 'This accepted trial moves no credits and earns no tutor payment.' : 'The confirmed price is fixed for this booking. Student cancellations more than 24 hours before start return all credits; 2–24 hours return half; under 2 hours return none under the standard policy.',
    ...(p.calendarAttached ? ['A calendar invitation is attached to this email.'] : []),
  ],
  details: [...lessonDetails(p), ['Lesson price', p.isTrial ? 'Free trial — no credits charged' : creditValue(p.priceCents)]],
  action: { label: 'View your booking', href: p.bookingUrl },
}));
export const plainText = BookingConfirmed.plainText;
export const subject = BookingConfirmed.subject;
export default BookingConfirmed;
