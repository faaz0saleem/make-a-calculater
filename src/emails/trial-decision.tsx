import { defineEmail } from './_shared/email';
import { lessonDetails } from './_shared/format';
import type { EmailBaseProps, LessonProps } from './_shared/types';
export type TrialDecisionProps = EmailBaseProps & LessonProps & (
  { decision: 'accepted' } | { decision: 'declined'; reason: string; browseUrl: string }
);
const TrialDecision = defineEmail<TrialDecisionProps>('TrialDecision', (p) => ({
  subject: `Your trial with ${p.counterpartName} was ${p.decision}`,
  preheader: p.decision === 'accepted' ? 'Your tutor approved the free trial.' : 'No credits were charged for this request.',
  heading: p.decision === 'accepted' ? 'Your trial is confirmed' : 'Your trial request was declined',
  paragraphs: p.decision === 'accepted'
    ? ['Your tutor accepted the request. Bring a question and discuss what you want to work on together.', 'This is a free trial. No credits are charged.']
    : [`Your tutor could not accept this request. Reason: ${p.reason}`, 'No credits were charged. You can browse another tutor’s availability.'],
  details: lessonDetails(p), action: { label: p.decision === 'accepted' ? 'View your trial' : 'Explore other tutors', href: p.decision === 'accepted' ? p.bookingUrl : p.browseUrl },
}));
export const plainText = TrialDecision.plainText;
export const subject = TrialDecision.subject;
export default TrialDecision;
