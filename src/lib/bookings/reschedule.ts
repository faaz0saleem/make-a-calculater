/**
 * Rescheduling a booking (SPEC.md §5).
 *
 * Once per booking, more than twelve hours before it starts, and the other side
 * has six hours to accept. All three limits exist for the same reason: a slot
 * that can be moved indefinitely is a slot the tutor cannot plan around.
 *
 * The original booking stands until the request is accepted, so the expiry is
 * six hours *or* the proposed new time, whichever comes first — accepting a
 * move to a slot that has already started would be nonsense. The original start
 * cannot bind: a request is only allowed more than twelve hours out, and six is
 * always less than twelve.
 */

export const MAX_RESCHEDULES = 1;
/** A request made closer than this to the start is refused. */
export const RESCHEDULE_MIN_HOURS_BEFORE = 12;
/** How long the other side has to answer. */
export const RESCHEDULE_RESPONSE_HOURS = 6;

const HOUR_MS = 60 * 60_000;

export type ReschedulableBooking = {
  status: string;
  startAtUtc: Date;
  rescheduleCount: number;
  isTrial: boolean;
};

export type RescheduleProblem =
  | 'not_reschedulable'
  | 'already_rescheduled'
  | 'too_close'
  | 'trial'
  | 'already_requested';

const MESSAGES: Record<RescheduleProblem, string> = {
  not_reschedulable: 'Only a confirmed session can be moved.',
  already_rescheduled: 'This session has already been moved once. Cancel it instead, or keep the time.',
  too_close: `A session can only be moved more than ${RESCHEDULE_MIN_HOURS_BEFORE} hours before it starts.`,
  trial: 'Free trials cannot be moved. Cancel and ask for another time.',
  already_requested: 'There is already a request waiting on an answer for this session.',
};

export function rescheduleProblemMessage(problem: RescheduleProblem): string {
  return MESSAGES[problem];
}

export function rescheduleProblem(
  booking: ReschedulableBooking,
  now: Date,
  hasOpenRequest = false,
): RescheduleProblem | null {
  if (booking.isTrial) return 'trial';
  if (booking.status !== 'confirmed') return 'not_reschedulable';
  if (hasOpenRequest) return 'already_requested';
  if (booking.rescheduleCount >= MAX_RESCHEDULES) return 'already_rescheduled';
  if (booking.startAtUtc.getTime() - now.getTime() <= RESCHEDULE_MIN_HOURS_BEFORE * HOUR_MS) {
    return 'too_close';
  }
  return null;
}

/**
 * When an unanswered request dies: six hours after it was made, or the moment
 * the proposed session would have started — whichever comes first.
 */
export function rescheduleExpiresAt(requestedAt: Date, newStartAtUtc: Date): Date {
  return new Date(
    Math.min(requestedAt.getTime() + RESCHEDULE_RESPONSE_HOURS * HOUR_MS, newStartAtUtc.getTime()),
  );
}

export function isRescheduleExpired(
  request: { requestedAt: Date; newStartAtUtc: Date },
  now: Date,
): boolean {
  return now.getTime() >= rescheduleExpiresAt(request.requestedAt, request.newStartAtUtc).getTime();
}
