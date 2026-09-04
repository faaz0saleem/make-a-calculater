/**
 * The tutor's incoming free-trial requests (SPEC.md §6).
 *
 * The clock is the point of this screen: a request dies twelve hours after it
 * was made, or two hours before the slot, whichever comes first. So each row
 * says how long is left in words rather than making the tutor work it out, and
 * says what declining costs — which is nothing, to anybody.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PendingTrial } from '@/db/trials';
import { formatInTimeZone } from '@/lib/time';

/** "4 hours left", "22 minutes left" — a countdown nobody has to compute. */
export function timeLeft(expiresAt: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 1_000));
  if (seconds === 0) return 'expiring now';
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} minutes left`;
  const hours = Math.round(seconds / 3_600);
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
}

export function TrialRequests({
  requests,
  timezone,
  now,
  action,
}: {
  requests: PendingTrial[];
  timezone: string;
  now: Date;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Free trial requests</CardTitle>
        <CardDescription>
          {requests.length === 0
            ? 'Nothing waiting on you.'
            : `${requests.length} waiting. Unanswered requests expire on their own — declining costs you nothing.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            When a student asks for a free trial it appears here, with the time you have left to answer.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-col gap-2 py-3 text-sm" data-testid="trial-request">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="font-medium">{request.studentName}</p>
                    <p className="text-muted-foreground">
                      {formatInTimeZone(request.startAtUtc, timezone)} · {request.durationMinutes} min
                    </p>
                  </div>
                  <Badge variant="secondary">{timeLeft(request.expiresAt, now)}</Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <form action={action}>
                    <input type="hidden" name="bookingId" value={request.id} />
                    <input type="hidden" name="decision" value="accept" />
                    <Button type="submit" size="sm" className="min-h-11">
                      Accept
                    </Button>
                  </form>
                  <form action={action}>
                    <input type="hidden" name="bookingId" value={request.id} />
                    <input type="hidden" name="decision" value="decline" />
                    <Button type="submit" size="sm" variant="outline" className="min-h-11">
                      Decline
                    </Button>
                  </form>
                </div>

                <p className="text-xs text-muted-foreground">
                  A free trial moves no money. Accepting holds {request.durationMinutes} minutes of your
                  calendar; declining leaves the student free to ask another tutor.
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
