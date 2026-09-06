import { defineEmail } from './_shared/email';
import { creditValue, lessonDetails } from './_shared/format';
import type { EmailBaseProps, LessonProps } from './_shared/types';
export type BookingCancelledProps = EmailBaseProps & LessonProps & {
  cancelledBy: 'student' | 'tutor'; recipientRole: 'student' | 'tutor';
  /** Snapshot from the resolved outcome; templates never recalculate a tier. */
  refundCents: number; retainedCents: number; reason?: string;
};
const BookingCancelled = defineEmail<BookingCancelledProps>('BookingCancelled', (p) => ({
  subject: `Booking cancelled with ${p.counterpartName}`, preheader: 'See the recorded credit outcome for this cancellation.', heading: 'This lesson has been cancelled',
  paragraphs: [
    `The ${p.cancelledBy} cancelled this booking.${p.reason ? ` Reason: ${p.reason}` : ''}`,
    p.recipientRole === 'student' ? 'The recorded refund returns to your student wallet as lesson credits, not cash, subject to mandatory legal rights.' : 'The student’s credit outcome is below. Your earnings, if any, are shown separately in your earnings ledger after settlement.',
    'Student notice tiers are: more than 24 hours, full credit refund; 2–24 hours, half; less than 2 hours, none. Tutor cancellations return the full booking price. The amounts below come from the resolved booking outcome.',
  ],
  details: [...lessonDetails(p), ['Credits returned to student', creditValue(p.refundCents)], ['Student credits retained', creditValue(p.retainedCents)]],
  action: { label: 'View the cancellation', href: p.bookingUrl },
}));
export const plainText = BookingCancelled.plainText;
export const subject = BookingCancelled.subject;
export default BookingCancelled;
