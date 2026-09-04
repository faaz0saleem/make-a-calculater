/**
 * A student's outstanding trial requests (SPEC.md §6).
 *
 * Says what is happening and when it stops happening. A request that nobody
 * answers dies quietly, so this screen has to be the place that admits it —
 * otherwise a student sits waiting on a slot that expired last night.
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { timeLeft } from '@/components/trials/trial-requests';
import type { PendingTrial } from '@/db/trials';
import { MAX_OUTSTANDING_TRIAL_REQUESTS } from '@/lib/trials/rules';
import { formatInTimeZone } from '@/lib/time';

export function OutgoingTrials({
  requests,
  timezone,
  now,
}: {
  requests: PendingTrial[];
  timezone: string;
  now: Date;
}) {
  if (requests.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trial requests you have sent</CardTitle>
        <CardDescription>
          {requests.length} of {MAX_OUTSTANDING_TRIAL_REQUESTS} you can have waiting at once. Nothing is
          charged for any of them.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm"
              data-testid="outgoing-trial"
            >
              <div className="min-w-0">
                <p className="font-medium">{request.tutorName}</p>
                <p className="text-muted-foreground">
                  {formatInTimeZone(request.startAtUtc, timezone)} · {request.durationMinutes} min
                </p>
              </div>
              <Badge variant="secondary">{timeLeft(request.expiresAt, now)} to answer</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
