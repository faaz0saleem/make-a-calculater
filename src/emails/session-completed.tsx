import { defineEmail } from './_shared/email';
import { lessonDetails, localTime } from './_shared/format';
import type { OptionalEmailProps, LessonProps } from './_shared/types';
export type SessionCompletedProps = OptionalEmailProps & LessonProps & { reviewUrl: string; disputeDeadline: string };
const SessionCompleted = defineEmail<SessionCompletedProps>('SessionCompleted', (p) => ({
  subject: `How was your lesson with ${p.counterpartName}?`,
  preheader: 'Your paid lesson is complete. Share your experience or report a problem.', heading: 'One lesson further',
  paragraphs: ['Your paid session has been marked complete. A review can help another student decide whether this tutor’s approach suits them.', 'If something went wrong, use the booking’s dispute controls promptly. The normal settlement window is shown below; mandatory complaint rights still apply afterwards. Keep children’s contact details and school information out of public reviews.'],
  details: [...lessonDetails(p), ['Normal dispute window closes', localTime(p.disputeDeadline, p.timezone)]],
  action: { label: 'Review your lesson', href: p.reviewUrl },
}));
export const plainText = SessionCompleted.plainText;
export const subject = SessionCompleted.subject;
export default SessionCompleted;
