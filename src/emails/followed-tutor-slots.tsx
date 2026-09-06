import { defineEmail } from './_shared/email';
import type { OptionalEmailProps } from './_shared/types';
export type FollowedTutorSlotsProps = OptionalEmailProps & { tutorName: string; profileUrl: string };
const FollowedTutorSlots = defineEmail<FollowedTutorSlotsProps>('FollowedTutorSlots', (p) => ({
  subject: `${p.tutorName} published more teaching time`, preheader: 'A tutor you follow added availability. Check the live calendar.', heading: 'More time with a tutor you follow',
  paragraphs: [`${p.tutorName} added availability to their teaching schedule. Open the profile to see the current slots in your timezone.`, 'This email does not reserve a slot. Availability and the final lesson price are confirmed in the booking flow. You can change these updates using the preferences below.'],
  action: { label: 'See current availability', href: p.profileUrl },
}));
export const plainText = FollowedTutorSlots.plainText;
export const subject = FollowedTutorSlots.subject;
export default FollowedTutorSlots;
