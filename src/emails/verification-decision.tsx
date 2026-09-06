import { defineEmail } from './_shared/email';
import type { EmailBaseProps } from './_shared/types';
export type VerificationDecisionProps = EmailBaseProps & (
  { decision: 'approved'; profileUrl: string } | { decision: 'rejected'; reason: string; resubmitUrl: string }
);
const VerificationDecision = defineEmail<VerificationDecisionProps>('VerificationDecision', (p) => ({
  subject: p.decision === 'approved' ? 'Your tutor profile is verified' : 'Your tutor application needs changes',
  preheader: p.decision === 'approved' ? 'Review your profile and published availability.' : 'Read the specific reason and resubmit when ready.',
  heading: p.decision === 'approved' ? 'You’re ready to be discovered' : 'Update your application',
  paragraphs: p.decision === 'approved'
    ? ['Your tutor profile has passed credential review. Check your published subjects, curriculum positions, rates and availability.', 'Verification does not guarantee student bookings or teaching outcomes. Keep your information accurate and follow the child-safety and professional-conduct rules.']
    : [`The reviewer could not approve your application. Reason: ${p.reason}`, 'Your profile will not appear in discovery or accept bookings while unverified. Update the requested information and resubmit for review.'],
  action: { label: p.decision === 'approved' ? 'View your tutor profile' : 'Update and resubmit', href: p.decision === 'approved' ? p.profileUrl : p.resubmitUrl },
}));
export const plainText = VerificationDecision.plainText;
export const subject = VerificationDecision.subject;
export default VerificationDecision;
