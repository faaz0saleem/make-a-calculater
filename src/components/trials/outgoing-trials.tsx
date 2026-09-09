/**
 * A student's outstanding trial requests (SPEC.md §6).
 *
 * Says what is happening and when it stops happening. A request that nobody
 * answers dies quietly, so this screen has to be the place that admits it —
 * otherwise a student sits waiting on a slot that expired last night.
 */

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { timeLeft } from '@/components/trials/trial-requests';
import type { PendingTrial } from '@/db/trials';
import { MAX_OUTSTANDING_TRIAL_REQUESTS, TRIAL_RESPONSE_WINDOW_HOURS } from '@/lib/trials/rules';
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
              <div className="text-right">
                <Badge variant="secondary">{timeLeft(request.expiresAt, now)} to answer</Badge>
                {/* The countdown alone answers "how long", not "until when" —
                    and a student planning their week needs the second one.
                    Their timezone, like every other time on this page. */}
                <p className="mt-1 text-xs text-muted-foreground" data-testid="trial-deadline">
                  Until {formatInTimeZone(request.expiresAt, timezone)}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {/* What happens if nobody answers. Without this the countdown is a
            source of anxiety rather than information: a student watching it
            run down has no idea whether they lose the slot, the trial, or
            their money — and the answer is none of the three. */}
        <p className="mt-4 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
          A tutor has {TRIAL_RESPONSE_WINDOW_HOURS} hours to answer, and less than that if the
          lesson is sooner. If the time runs out the request simply lapses — you are not charged,
          the slot goes back on their calendar, and because they never answered, your one free trial
          with them is still yours to use.{' '}
          <Link href="/" className="underline underline-offset-4">
            Ask somebody else
          </Link>{' '}
          in the meantime; you can have {MAX_OUTSTANDING_TRIAL_REQUESTS} waiting at once.
        </p>
      </CardContent>
    </Card>
  );
}
