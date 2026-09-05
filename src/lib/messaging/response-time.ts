/**
 * How quickly a tutor answers (SPEC.md §4, §8).
 *
 * Feeds two things: the `response_speed` term of the ranking score, and the
 * "Responds in <1h" badge on the card. Both read a stored median rather than
 * computing anything in the request path.
 *
 * Pure, so the definition of "a reply" is visible. Two decisions worth naming:
 *
 *  - Only the **first** tutor message after a student writes counts. A tutor
 *    who sends four messages in a row has answered once, not four times.
 *  - A student message left unanswered past the ceiling counts as a reply *at*
 *    the ceiling. Otherwise ignoring somebody entirely would leave no data
 *    point at all, and silence would score better than a slow answer.
 */

import { RESPONSE_SPEED_CEILING_SECONDS } from '@/lib/ranking/score';

export type ThreadMessage = {
  senderId: string;
  createdAt: Date;
};

/**
 * Seconds between each student message that opened a wait and the tutor's next
 * reply, in the order the waits started.
 */
export function replyLatencies(
  messages: ThreadMessage[],
  tutorId: string,
  now: Date,
  ceilingSeconds = RESPONSE_SPEED_CEILING_SECONDS,
): number[] {
  const ordered = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latencies: number[] = [];
  let waitingSince: Date | null = null;

  for (const message of ordered) {
    const fromTutor = message.senderId === tutorId;

    if (!fromTutor) {
      // The clock starts on the first message of a student's burst.
      waitingSince ??= message.createdAt;
      continue;
    }

    if (waitingSince) {
      latencies.push(Math.max(0, Math.round((message.createdAt.getTime() - waitingSince.getTime()) / 1_000)));
      waitingSince = null;
    }
  }

  // Still unanswered. Only counts once the tutor has run out of excuses.
  if (waitingSince) {
    const waited = Math.round((now.getTime() - waitingSince.getTime()) / 1_000);
    if (waited >= ceilingSeconds) latencies.push(ceilingSeconds);
  }

  return latencies;
}

/** The middle value; the mean of the middle two when there is an even count. */
export function medianSeconds(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** The median across every thread a tutor is in. */
export function responseMedianFor(
  threads: ThreadMessage[][],
  tutorId: string,
  now: Date,
): number | null {
  return medianSeconds(threads.flatMap((thread) => replyLatencies(thread, tutorId, now)));
}

/** "under an hour", "about 3 hours", "over a day" — for the profile. */
export function describeResponseTime(medianSeconds: number | null): string | null {
  if (medianSeconds === null) return null;
  if (medianSeconds < 3_600) return 'Usually replies within an hour';
  if (medianSeconds < 6 * 3_600) return `Usually replies within ${Math.round(medianSeconds / 3_600)} hours`;
  if (medianSeconds < 24 * 3_600) return 'Usually replies within a day';
  return 'Can take more than a day to reply';
}
