/**
 * The link into a session, and what it says when the room is not open yet.
 *
 * A booking row is the last place someone sees before a lesson, so it carries
 * the cancellation consequence too (SPEC.md §2): a student who cancels ninety
 * minutes before start is not refunded, and should be told that before they
 * click, not after.
 */

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { joinState, sessionWindow } from '@/lib/sessions/window';
import { formatInTimeZone } from '@/lib/time';

export type JoinLinkBooking = {
  id: string;
  startAtUtc: Date;
  durationMinutes: number;
  status: string;
  isTrial: boolean;
  priceCents: number;
};

export function JoinLink({
  booking,
  timezone,
  now,
}: {
  booking: JoinLinkBooking;
  timezone: string;
  now: Date;
}) {
  const window = sessionWindow(booking.startAtUtc, booking.durationMinutes);
  const state = joinState(window, now);

  if (!['confirmed', 'in_progress'].includes(booking.status)) return null;

  if (state.canJoin) {
    return (
      <Link href={`/sessions/${booking.id}`}>
        <Button size="sm" className="min-h-11">
          {state.phase === 'early' ? 'Join early' : 'Join now'}
        </Button>
      </Link>
    );
  }

  if (state.phase === 'over') {
    return <span className="text-xs text-muted-foreground">Ended</span>;
  }

  return (
    <span className="text-xs text-muted-foreground">
      Opens {formatInTimeZone(window.joinOpensUtc, timezone, { timeStyle: 'short' })}
    </span>
  );
}
