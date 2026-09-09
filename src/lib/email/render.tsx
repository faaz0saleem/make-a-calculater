/**
 * Kind plus data in, an email out (SPEC.md §11).
 *
 * One place that knows which template answers which event, so a caller says
 * *what happened* and never *which component renders it*. The envelope —
 * greeting name, help and privacy links, the preference and unsubscribe links
 * where they apply — is added here rather than passed in by fourteen call
 * sites, because a message that reached somebody without a working unsubscribe
 * link is the one mistake in email that is expensive to make.
 *
 * Rendering is `renderToStaticMarkup`: these are static documents with no
 * hydration, no state and no client. React Email would add a dependency to
 * produce the same string.
 *
 * It is imported at runtime with `webpackIgnore`, and that is not decoration.
 * Next refuses to build any module in the app graph that statically imports
 * `react-dom/server` — a sensible rule aimed at people accidentally
 * server-rendering inside a server component, and one that also catches the
 * legitimate case of turning a template into a string to hand to a mail
 * provider. The alternative was a second HTML renderer used only in production
 * while the tested one was used only in tests, which is how two documents drift
 * apart. One renderer, one runtime import, one comment.
 */

import * as templates from '@/emails';
import type { OptionalEmailProps } from '@/emails/_shared/types';
import { isOptionalEmail, type EmailKind } from './kinds';
import { unsubscribeToken } from './unsubscribe';

/**
 * Everything a template needs that the sender is expected to know.
 *
 * Distributive on purpose. Several templates are unions — a trial decision is
 * accepted *or* declined-with-a-reason — and a plain `Omit` over a union
 * collapses it to the fields both branches share, which quietly makes the
 * reason unpassable.
 */
type Data<Props> = Props extends unknown ? Omit<Props, keyof OptionalEmailProps> : never;

/**
 * The payload union. Exhaustive on purpose: adding a kind without a payload,
 * or a payload whose fields do not match its template, fails to compile.
 */
export type EmailPayload =
  | { kind: 'password_reset'; data: Data<templates.PasswordResetProps> }
  | { kind: 'email_verification'; data: Data<templates.EmailVerificationProps> }
  | { kind: 'booking_confirmed'; data: Data<templates.BookingConfirmedProps> }
  | { kind: 'booking_cancelled'; data: Data<templates.BookingCancelledProps> }
  | { kind: 'reminder_24h'; data: Data<templates.Reminder24hProps> }
  | { kind: 'reminder_1h'; data: Data<templates.Reminder1hProps> }
  | { kind: 'session_starting'; data: Data<templates.SessionStartingProps> }
  | { kind: 'session_completed'; data: Data<templates.SessionCompletedProps> }
  | { kind: 'trial_requested'; data: Data<templates.TrialRequestedProps> }
  | { kind: 'trial_decision'; data: Data<templates.TrialDecisionProps> }
  | { kind: 'credits_purchased'; data: Data<templates.CreditsPurchasedProps> }
  | { kind: 'credits_low'; data: Data<templates.CreditsLowProps> }
  | { kind: 'verification_decision'; data: Data<templates.VerificationDecisionProps> }
  | { kind: 'payout_status'; data: Data<templates.PayoutStatusProps> }
  | { kind: 'new_review'; data: Data<templates.NewReviewProps> }
  | { kind: 'followed_tutor_slots'; data: Data<templates.FollowedTutorSlotsProps> };

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  /** For `List-Unsubscribe`, which every mail client but one honours. */
  unsubscribeUrl: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- the union above is the
   type boundary; inside this map the component and its props are matched by
   construction and TypeScript cannot follow the pairing through a lookup. */
const COMPONENTS: Record<EmailKind, any> = {
  password_reset: templates.PasswordReset,
  email_verification: templates.EmailVerification,
  booking_confirmed: templates.BookingConfirmed,
  booking_cancelled: templates.BookingCancelled,
  reminder_24h: templates.Reminder24h,
  reminder_1h: templates.Reminder1h,
  session_starting: templates.SessionStarting,
  session_completed: templates.SessionCompleted,
  trial_requested: templates.TrialRequested,
  trial_decision: templates.TrialDecision,
  credits_purchased: templates.CreditsPurchased,
  credits_low: templates.CreditsLow,
  verification_decision: templates.VerificationDecision,
  payout_status: templates.PayoutStatus,
  new_review: templates.NewReview,
  followed_tutor_slots: templates.FollowedTutorSlots,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type Recipient = {
  userId: string;
  name: string;
};

export async function renderEmail(
  payload: EmailPayload,
  recipient: Recipient,
  origin: string,
): Promise<RenderedEmail> {
  const { renderToStaticMarkup } = (await import(
    /* webpackIgnore: true */ 'react-dom/server'
  )) as typeof import('react-dom/server');

  const optional = isOptionalEmail(payload.kind);

  // One link per kind rather than one for everything: somebody who is tired of
  // "a tutor you follow opened time" is not asking to stop hearing that their
  // session starts in an hour, and making them choose between the two loses
  // both.
  const unsubscribeUrl = optional
    ? `${origin}/unsubscribe/${unsubscribeToken(recipient.userId, payload.kind)}`
    : null;

  const props = {
    ...payload.data,
    recipientName: recipient.name,
    supportUrl: `${origin}/help`,
    privacyUrl: `${origin}/privacy`,
    ...(optional
      ? { preferencesUrl: `${origin}/settings/email`, unsubscribeUrl: unsubscribeUrl! }
      : {}),
  };

  const Component = COMPONENTS[payload.kind];

  return {
    subject: Component.subject(props),
    html: `<!doctype html>${renderToStaticMarkup(<Component {...props} />)}`,
    text: Component.plainText(props),
    unsubscribeUrl,
  };
}
