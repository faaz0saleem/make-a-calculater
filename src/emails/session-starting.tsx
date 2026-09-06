import { defineEmail } from './_shared/email';
import { lessonDetails } from './_shared/format';
import type { OptionalEmailProps, LessonProps } from './_shared/types';
export type SessionStartingProps = OptionalEmailProps & LessonProps & { classroomUrl: string };
const SessionStarting = defineEmail<SessionStartingProps>('SessionStarting', (p) => ({
  subject: `Your lesson starts in about 10 minutes`,
  preheader: 'Open the classroom preparation screen; joining opens five minutes before start.', heading: 'Get ready to meet your tutor or student',
  paragraphs: ['Your lesson starts in about 10 minutes. Open the classroom now to prepare; access to the call opens five minutes before the scheduled start.', 'Keep the lesson on Tutorly so the booking and attendance can be supported. The exact scheduled time below takes priority if this email arrives late.'],
  details: lessonDetails(p), action: { label: 'Open the classroom', href: p.classroomUrl },
}));
export const plainText = SessionStarting.plainText;
export const subject = SessionStarting.subject;
export default SessionStarting;
