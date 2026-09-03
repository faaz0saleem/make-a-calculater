'use client';

/**
 * Records the viewer's timezone in a cookie so the server can render times in
 * it (SPEC.md §5: the calendar is shown in the student's timezone).
 *
 * A signed-in user has one on their account. A signed-out visitor does not, and
 * showing them UTC would be useless — so the browser tells us once, and the
 * page re-renders. It refreshes only when the value actually changes, so there
 * is no loop.
 */

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export const TIMEZONE_COOKIE = 'tutorly_tz';

export function TimezoneProbe({ current }: { current: string | null }) {
  const router = useRouter();

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected || detected === current) return;

    document.cookie = `${TIMEZONE_COOKIE}=${encodeURIComponent(detected)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  }, [current, router]);

  return null;
}
