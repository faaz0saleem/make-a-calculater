/**
 * Turning a database row into what a card needs (SPEC.md §4).
 *
 * Kept out of the components so the badge rules and the availability decision
 * are applied once, server-side, rather than repeated in each place a card
 * appears.
 */

import { getAvailability } from '@/lib/availability';
import type { FeedTutor } from '@/db/discovery';
import { badgesFor } from './badges';
import type { TutorCardData } from '@/components/feed/tutor-card';
import { formatInTimeZone } from '@/lib/time';

/**
 * "Next free: Today 6:30 PM", in the *viewer's* timezone (SPEC.md §4).
 *
 * Returns null while the availability engine does not exist, so the line is
 * absent rather than invented.
 */
function nextFreeLabel(startAtUtc: Date | null, viewerTimezone: string, now: Date): string | null {
  if (!startAtUtc) return null;

  const sameDay =
    formatInTimeZone(startAtUtc, viewerTimezone, { dateStyle: 'short' }) ===
    formatInTimeZone(now, viewerTimezone, { dateStyle: 'short' });

  const time = formatInTimeZone(startAtUtc, viewerTimezone, { timeStyle: 'short' });
  if (sameDay) return `Next free: Today ${time}`;

  const day = formatInTimeZone(startAtUtc, viewerTimezone, { weekday: 'short', month: 'short', day: 'numeric' });
  return `Next free: ${day} ${time}`;
}

export async function toCardData(
  tutors: FeedTutor[],
  viewerTimezone: string,
  now = new Date(),
): Promise<TutorCardData[]> {
  const availability = getAvailability();

  return Promise.all(
    tutors.map(async (tutor) => {
      const [today, next] = await Promise.all([
        availability.isAvailableToday(tutor.id),
        availability.nextFreeSlot(tutor.id),
      ]);

      return {
        id: tutor.id,
        name: tutor.name,
        headline: tutor.headline,
        avatarUrl: tutor.avatarUrl,
        city: tutor.city,
        country: tutor.country,
        hourlyCents: tutor.hourlyCents,
        halfHourCents: tutor.halfHourCents,
        promoCents: tutor.promoCents,
        ratingMilli: tutor.ratingMilli,
        reviewCount: Number(tutor.reviewCount ?? 0),
        subjectNames: tutor.subjectNames ?? [],
        posterUrl: tutor.posterUrl,
        previewUrl: tutor.previewUrl,
        badges: badgesFor(
          {
            offersTrial: tutor.offersTrial,
            trialMinutes: tutor.trialMinutes,
            responseMedianSeconds: tutor.responseMedianSeconds,
            verifiedAt: tutor.verifiedAt,
            availableToday: today.known ? today.value : null,
          },
          now,
        ),
        nextFreeLabel: next.known ? nextFreeLabel(next.value?.startUtc ?? null, viewerTimezone, now) : null,
      };
    }),
  );
}
