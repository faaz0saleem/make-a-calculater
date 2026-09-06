import { defineEmail } from './_shared/email';
import { lessonDetails, localTime } from './_shared/format';
import type { EmailBaseProps, LessonProps } from './_shared/types';
export type TrialRequestedProps = EmailBaseProps & LessonProps & { expiresAt: string };
const TrialRequested = defineEmail<TrialRequestedProps>('TrialRequested', (p) => ({
  subject: `${p.counterpartName} requested a free trial`,
  preheader: 'A trial needs your approval before it is confirmed.', heading: 'A student would like to meet you',
  paragraphs: ['Review the student’s request and choose whether to accept or decline. Offering trials is optional; this request is not a confirmed lesson.', 'A free trial moves no credits and produces no tutor earnings. Respond before the expiry below; the request expires after 12 hours or two hours before the proposed start, whichever is earlier.'],
  details: [...lessonDetails(p), ['Respond by', localTime(p.expiresAt, p.timezone)]],
  action: { label: 'Review the trial request', href: p.bookingUrl },
}));
export const plainText = TrialRequested.plainText;
export const subject = TrialRequested.subject;
export default TrialRequested;
