'use client';

/**
 * The session clock.
 *
 * It counts from the booking's scheduled start, which is server truth, not from
 * when the room connected. That is what makes it survive a reconnect: there is
 * no local timer to restart, so dropping off a train and rejoining shows the
 * time that has actually passed rather than starting again from zero.
 *
 * The offset corrects for a device clock being wrong, which on a cheap phone it
 * often is by minutes.
 */

import { useEffect, useState } from 'react';

export function useServerNow(serverNowIso: string | null): () => Date {
  const [offsetMs, setOffsetMs] = useState(0);

  useEffect(() => {
    if (!serverNowIso) return;
    setOffsetMs(new Date(serverNowIso).getTime() - Date.now());
  }, [serverNowIso]);

  return () => new Date(Date.now() + offsetMs);
}

/** Ticks once a second, returning corrected server time. */
export function useTick(serverNowIso: string | null): Date {
  const now = useServerNow(serverNowIso);
  const [value, setValue] = useState(() => now());

  useEffect(() => {
    const timer = setInterval(() => setValue(now()), 1_000);
    return () => clearInterval(timer);
    // `now` is recreated when the offset changes, which is exactly when the
    // interval should be rebuilt.
  }, [now]);

  return value;
}

export function formatDuration(totalSeconds: number): string {
  const negative = totalSeconds < 0;
  const seconds = Math.abs(Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${negative ? '-' : ''}${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
