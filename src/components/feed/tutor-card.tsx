'use client';

/**
 * A tutor card (SPEC.md §4).
 *
 * The 16:9 preview autoplays muted — on hover on a pointer device, and when the
 * card is at least half on screen on a touch device — for eight seconds, then
 * stops and returns to the poster.
 *
 * The preview is a short muted MP4 produced by the video pipeline, not the HLS
 * ladder: a card should not have to load a streaming player to show eight
 * seconds of someone talking.
 *
 * A viewer who has asked for reduced motion never gets autoplay.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { formatCents } from '@/lib/money/cents';
import type { TutorBadge } from '@/lib/tutors/badges';
import { cn } from '@/lib/utils';

/** SPEC.md §4: eight seconds. */
const PREVIEW_MS = 8_000;

export type TutorCardData = {
  id: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  city: string | null;
  country: string | null;
  hourlyCents: number;
  halfHourCents: number;
  promoCents: number | null;
  ratingMilli: number | null;
  reviewCount: number;
  subjectNames: string[];
  posterUrl: string | null;
  previewUrl: string | null;
  badges: TutorBadge[];
  /** "Next free: Today 6:30 PM", or null while the calendar is unknown. */
  nextFreeLabel: string | null;
};

export function TutorCard({ tutor, className }: { tutor: TutorCardData; className?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);

  const stop = useCallback(() => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setPlaying(false);
  }, []);

  const start = useCallback(() => {
    const video = videoRef.current;
    if (!video || !tutor.previewUrl) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    video.muted = true;
    // A blocked autoplay is not an error worth surfacing — the poster stays.
    void video.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );

    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(stop, PREVIEW_MS);
  }, [stop, tutor.previewUrl]);

  // Touch devices have no hover, so play when the card is half on screen.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !tutor.previewUrl) return;
    if (window.matchMedia('(hover: hover)').matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) start();
        else stop();
      },
      { threshold: 0.5 },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [start, stop, tutor.previewUrl]);

  useEffect(() => stop, [stop]);

  const rating = tutor.ratingMilli === null ? null : (tutor.ratingMilli / 1_000).toFixed(1);
  const onPromo = tutor.promoCents !== null && tutor.promoCents < tutor.hourlyCents;

  return (
    <article ref={containerRef} className={cn('group flex flex-col', className)} data-testid="tutor-card">
      <Link href={`/tutors/${tutor.id}`} className="flex flex-1 flex-col gap-3">
        <div
          className="relative aspect-video w-full overflow-hidden rounded-lg bg-secondary"
          onMouseEnter={start}
          onMouseLeave={stop}
          onFocus={start}
          onBlur={stop}
        >
          {tutor.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tutor.posterUrl}
              alt=""
              className={cn(
                'absolute inset-0 size-full object-cover transition-opacity duration-200',
                playing ? 'opacity-0' : 'opacity-100',
              )}
              loading="lazy"
            />
          ) : null}

          {tutor.previewUrl ? (
            <video
              ref={videoRef}
              src={tutor.previewUrl}
              muted
              playsInline
              preload="none"
              aria-hidden
              className={cn(
                'absolute inset-0 size-full object-cover transition-opacity duration-200',
                playing ? 'opacity-100' : 'opacity-0',
              )}
            />
          ) : null}

          {!tutor.posterUrl && !tutor.previewUrl ? (
            <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
              No intro video yet
            </span>
          ) : null}
        </div>

        <div className="flex items-start gap-3">
          {tutor.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tutor.avatarUrl}
              alt=""
              className="size-9 shrink-0 rounded-full border border-border object-cover"
              loading="lazy"
            />
          ) : (
            <span className="size-9 shrink-0 rounded-full bg-secondary" aria-hidden />
          )}

          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-1 truncate text-sm font-semibold group-hover:underline">
              {tutor.name}
              <span className="text-[var(--success)]" title="Verified" aria-label="Verified">
                ✓
              </span>
            </h3>
            <p className="line-clamp-2 text-xs text-muted-foreground">{tutor.headline}</p>
          </div>
        </div>
      </Link>

      <div className="mt-2 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {tutor.subjectNames.slice(0, 3).map((subject) => (
            <Badge key={subject} variant="secondary" className="text-[10px]">
              {subject}
            </Badge>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium" data-testid="card-price">
            {onPromo ? (
              <>
                <span className="mr-1 text-muted-foreground line-through">{formatCents(tutor.hourlyCents)}</span>
                {formatCents(tutor.promoCents!)}
              </>
            ) : (
              formatCents(tutor.hourlyCents)
            )}
            <span className="text-muted-foreground">/hr</span>
          </span>

          <span className="shrink-0 text-xs text-muted-foreground">
            {rating ? `★ ${rating} (${tutor.reviewCount})` : 'No reviews yet'}
          </span>
        </div>

        {tutor.badges.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {tutor.badges.map((badge) => (
              <Badge key={badge.kind} variant={badge.tone} className="text-[10px]">
                {badge.label}
              </Badge>
            ))}
          </div>
        ) : null}

        {tutor.nextFreeLabel ? (
          <p className="text-xs text-muted-foreground">{tutor.nextFreeLabel}</p>
        ) : null}
      </div>
    </article>
  );
}
