/**
 * The badges on a tutor card (SPEC.md §4).
 *
 *   Free trial · Available today · Responds in <1h · New
 *
 * Pure, so what a student sees is decided by one tested function rather than by
 * conditions scattered through JSX.
 *
 * "Available today" needs the availability engine, which is Phase 3. Until then
 * the availability port answers "unknown" and the badge is simply not shown —
 * an absent badge costs nothing, while a wrong one costs a wasted click and
 * some trust.
 */

export type BadgeKind = 'free_trial' | 'available_today' | 'fast_responder' | 'new';

export type TutorBadge = {
  kind: BadgeKind;
  label: string;
  tone: 'default' | 'secondary' | 'success' | 'outline';
};

/** A median first reply under this counts as fast (SPEC.md §4). */
export const FAST_RESPONSE_SECONDS = 60 * 60;

/** How long a verified tutor is still "New". */
export const NEW_TUTOR_DAYS = 30;

export type BadgeInputs = {
  offersTrial: boolean;
  trialMinutes: number;
  responseMedianSeconds: number | null;
  verifiedAt: Date | null;
  /** From the availability port. `null` means it does not know yet. */
  availableToday: boolean | null;
};

export function isNewTutor(verifiedAt: Date | null, now: Date): boolean {
  if (!verifiedAt) return false;
  const days = (now.getTime() - verifiedAt.getTime()) / 86_400_000;
  return days >= 0 && days <= NEW_TUTOR_DAYS;
}

export function isFastResponder(responseMedianSeconds: number | null): boolean {
  return responseMedianSeconds !== null && responseMedianSeconds < FAST_RESPONSE_SECONDS;
}

export function badgesFor(inputs: BadgeInputs, now: Date): TutorBadge[] {
  const badges: TutorBadge[] = [];

  if (inputs.offersTrial) {
    badges.push({ kind: 'free_trial', label: `Free ${inputs.trialMinutes}-min trial`, tone: 'success' });
  }

  // Only shown when the calendar actually said yes.
  if (inputs.availableToday === true) {
    badges.push({ kind: 'available_today', label: 'Available today', tone: 'default' });
  }

  if (isFastResponder(inputs.responseMedianSeconds)) {
    badges.push({ kind: 'fast_responder', label: 'Responds in <1h', tone: 'secondary' });
  }

  if (isNewTutor(inputs.verifiedAt, now)) {
    badges.push({ kind: 'new', label: 'New', tone: 'outline' });
  }

  return badges;
}
