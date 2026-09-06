'use client';

/**
 * The device clock and the profile disagree (SPEC.md §7, §13.3).
 *
 * Somebody who travels, or who set their timezone once and moved, sees session
 * times in a zone they are no longer in — and the failure is silent right up
 * until they miss a lesson by five hours. This is the one moment worth
 * interrupting them about, so it names both times for the next session rather
 * than saying "your timezone may be wrong", which nobody acts on.
 *
 * It does not change anything on its own. Guessing that somebody has moved
 * permanently because they opened the app in an airport would be worse than the
 * problem: their tutor's hours, their standing slot and every booking they have
 * are all anchored to the zone they actually live in.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function TimezoneDrift({
  profileTimezone,
  nextSessionIso,
}: {
  profileTimezone: string;
  nextSessionIso: string | null;
}) {
  const [deviceTimezone, setDeviceTimezone] = useState<string | null>(null);

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setDeviceTimezone(detected && detected !== profileTimezone ? detected : null);
  }, [profileTimezone]);

  if (!deviceTimezone) return null;

  const format = (zone: string) =>
    nextSessionIso
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: zone,
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(nextSessionIso))
      : null;

  const here = format(deviceTimezone);
  const there = format(profileTimezone);

  return (
    <div
      role="status"
      className="rounded-md border border-border bg-secondary px-4 py-3 text-sm"
      data-testid="timezone-drift"
    >
      <p className="font-medium">
        This device is on {deviceTimezone}. Your account says {profileTimezone}.
      </p>

      {here && there ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Your next session is <strong>{there}</strong> in your account&rsquo;s timezone, which is{' '}
          <strong>{here}</strong> where this device thinks you are. Session times on this site are
          shown in {profileTimezone}.
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Session times on this site are shown in {profileTimezone}.
        </p>
      )}

      <p className="mt-2 text-xs">
        <Link href="/settings/curriculum" className="underline underline-offset-4">
          Change your timezone
        </Link>{' '}
        if you have moved. If you are travelling, leave it — your tutor&rsquo;s hours have not moved.
      </p>
    </div>
  );
}
