/**
 * What you can do to a booking, and what it costs you (SPEC.md §5, §10).
 *
 * Every control here says its consequence before it happens: cancelling names
 * the refund in cents, reporting says the money stops moving, moving a session
 * says it needs the other side to agree. None of that is decoration — the
 * cancellation copy comes from the same constants `resolveBookingOutcome` uses,
 * so it cannot drift from what the ledger actually does.
 */

import { Button } from '@/components/ui/button';
import { cancellationConsequence, type CancellableBooking } from '@/lib/sessions/cancellation';
import { rescheduleProblem } from '@/lib/bookings/reschedule';
import { formatInTimeZone } from '@/lib/time';

export type ActionableBooking = CancellableBooking & {
  id: string;
  status: string;
  durationMinutes: number;
  rescheduleCount: number;
  completedAt: Date | null;
  settledAt: Date | null;
};

export function BookingActions({
  booking,
  now,
  timezone,
  returnTo,
  freeSlots,
  canReport,
  cancelAction,
  rescheduleAction,
  reportAction,
}: {
  booking: ActionableBooking;
  now: Date;
  timezone: string;
  returnTo: string;
  /** Times this booking could move to, from the availability engine. */
  freeSlots: Date[];
  canReport: boolean;
  cancelAction: (formData: FormData) => void | Promise<void>;
  rescheduleAction: (formData: FormData) => void | Promise<void>;
  reportAction: (formData: FormData) => void | Promise<void>;
}) {
  const cancellable = ['pending_tutor', 'confirmed'].includes(booking.status);
  const movable = rescheduleProblem(booking, now) === null && freeSlots.length > 0;

  if (!cancellable && !canReport) return null;

  return (
    <div className="flex flex-col gap-2">
      {cancellable ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground underline underline-offset-4">
            Cancel or move this session
          </summary>

          <div className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3">
            <form action={cancelAction} className="flex flex-col gap-2">
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <p>{cancellationConsequence(booking, now)}</p>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                className="min-h-11 self-start"
                data-testid="cancel-booking"
              >
                Cancel this session
              </Button>
            </form>

            {movable ? (
              <form action={rescheduleAction} className="flex flex-col gap-2 border-t border-border pt-3">
                <input type="hidden" name="bookingId" value={booking.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <label className="flex flex-col gap-1">
                  <span>Move it to</span>
                  <select
                    name="newStartUtc"
                    className="min-h-11 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {freeSlots.map((slot) => (
                      <option key={slot.toISOString()} value={slot.toISOString()}>
                        {formatInTimeZone(slot, timezone, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-muted-foreground">
                  A session can be moved once, and the other person has six hours to agree. Until they do,
                  the original time stands.
                </p>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="min-h-11 self-start"
                  data-testid="request-reschedule"
                >
                  Ask to move it
                </Button>
              </form>
            ) : booking.rescheduleCount > 0 ? (
              <p className="border-t border-border pt-3 text-muted-foreground">
                This session has already been moved once.
              </p>
            ) : null}
          </div>
        </details>
      ) : null}

      {canReport ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground underline underline-offset-4">
            Something went wrong with this session
          </summary>

          <form action={reportAction} className="mt-2 flex flex-col gap-2 rounded-md border border-border p-3">
            <input type="hidden" name="bookingId" value={booking.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="flex flex-col gap-1">
              <span>What happened?</span>
              <input
                name="reason"
                required
                maxLength={120}
                placeholder="They never joined / the audio failed / …"
                className="min-h-11 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <textarea
              name="body"
              rows={2}
              maxLength={2_000}
              placeholder="Anything else that would help us sort it out."
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-muted-foreground">
              Reporting freezes the money on this session — nothing is paid out or refunded until somebody
              has looked at it.
            </p>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="min-h-11 self-start"
              data-testid="report-problem"
            >
              Report a problem
            </Button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

/** The open reschedule requests waiting on this person. */
export function RescheduleInbox({
  requests,
  userId,
  timezone,
  now,
  returnTo,
  action,
}: {
  requests: {
    id: string;
    requestedById: string;
    otherName: string;
    originalStartAtUtc: Date;
    newStartAtUtc: Date;
    expiresAt: Date;
    note: string | null;
  }[];
  userId: string;
  timezone: string;
  now: Date;
  returnTo: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  if (requests.length === 0) return null;

  const hoursLeft = (expiresAt: Date) =>
    Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 3_600_000));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary bg-card p-4">
      <h2 className="text-base font-semibold">Requests to move a session</h2>

      <ul className="flex flex-col divide-y divide-border">
        {requests.map((request) => {
          const mine = request.requestedById === userId;

          return (
            <li key={request.id} className="flex flex-col gap-2 py-3 text-sm" data-testid="reschedule-request">
              <p>
                <strong>{mine ? 'You asked' : `${request.otherName} asked`}</strong> to move the session on{' '}
                {formatInTimeZone(request.originalStartAtUtc, timezone)} to{' '}
                <strong>{formatInTimeZone(request.newStartAtUtc, timezone)}</strong>.
              </p>
              {request.note ? <p className="text-muted-foreground">“{request.note}”</p> : null}

              {mine ? (
                <p className="text-xs text-muted-foreground">
                  Waiting on {request.otherName} — {hoursLeft(request.expiresAt)} hours left before it
                  lapses and the original time stands.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <form action={action}>
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="decision" value="accept" />
                    <Button type="submit" size="sm" className="min-h-11" data-testid="accept-reschedule">
                      Move it
                    </Button>
                  </form>
                  <form action={action}>
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="decision" value="decline" />
                    <Button type="submit" size="sm" variant="outline" className="min-h-11">
                      Keep the original time
                    </Button>
                  </form>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
