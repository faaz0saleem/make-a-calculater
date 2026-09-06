import { defineEmail } from './_shared/email';
import type { OptionalEmailProps } from './_shared/types';
export type NewReviewProps = OptionalEmailProps & { rating: number; reviewText?: string | null; reviewUrl: string };
const NewReview = defineEmail<NewReviewProps>('NewReview', (p) => {
  if (!Number.isInteger(p.rating) || p.rating < 1 || p.rating > 5) throw new Error('Review rating must be 1–5.');
  return { subject: 'A student reviewed your lesson', preheader: 'Read their feedback and add a professional reply.', heading: 'You have a new review',
    paragraphs: ['A student left feedback on a completed paid lesson. Read the review on your profile; you can add one public reply.', ...(p.reviewText ? [`Their feedback: ${p.reviewText}`] : ['The student left a rating without a written comment.']), 'Keep your reply constructive and avoid identifying a child or sharing lesson details they have not chosen to publish.'],
    details: [['Rating', `${p.rating} out of 5`]], action: { label: 'Read the review', href: p.reviewUrl },
  };
});
export const plainText = NewReview.plainText;
export const subject = NewReview.subject;
export default NewReview;
