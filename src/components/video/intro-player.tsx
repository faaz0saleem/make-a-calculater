'use client';

/**
 * The intro-video hero on a tutor's profile (SPEC.md §4).
 *
 * A plain `<video>`. The pipeline produces two fixed MP4 renditions rather than
 * an HLS ladder — see `src/lib/video/types.ts` for why — so there is no player
 * library to load and nothing to fall back from.
 *
 * It does not autoplay: this is a page someone chose to open, and starting
 * sound unasked is rude. The card in the feed is where autoplay belongs.
 */

import { useRef, useState } from 'react';

export function IntroPlayer({
  heroUrl,
  previewUrl,
  posterUrl,
  name,
}: {
  heroUrl: string | null;
  previewUrl: string | null;
  posterUrl: string | null;
  name: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [started, setStarted] = useState(false);

  // The hero is the full clip with sound; the preview is the fallback when a
  // video predates the hero rendition.
  const source = heroUrl ?? previewUrl;

  if (!source) {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-lg bg-secondary text-sm text-muted-foreground">
        {name} has not added an intro video yet.
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        src={source}
        controls={started}
        playsInline
        preload="none"
        poster={posterUrl ?? undefined}
        className="size-full object-contain"
        aria-label={`Intro video from ${name}`}
      />

      {!started ? (
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            void videoRef.current?.play().catch(() => undefined);
          }}
          className="absolute inset-0 grid place-items-center bg-black/20 transition-colors hover:bg-black/30"
        >
          <span className="grid size-16 place-items-center rounded-full bg-white/90 text-2xl text-black shadow-lg">
            ▶
          </span>
          <span className="sr-only">Play {name}&rsquo;s intro video</span>
        </button>
      ) : null}
    </div>
  );
}
