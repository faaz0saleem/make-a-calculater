'use client';

/**
 * The intro-video hero on a tutor's profile (SPEC.md §4).
 *
 * Plays the HLS rendition, because that is what the pipeline produces and what
 * behaves on a bad connection. Safari plays HLS natively; everywhere else
 * hls.js is loaded on demand, and only once the viewer presses play — a feed
 * visitor who never opens a profile never downloads it.
 *
 * If HLS cannot be played at all, the short preview MP4 is used instead. A
 * tutor's profile should never show a broken player.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function IntroPlayer({
  hlsUrl,
  previewUrl,
  posterUrl,
  name,
}: {
  hlsUrl: string | null;
  previewUrl: string | null;
  posterUrl: string | null;
  name: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  const attach = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    // Safari and iOS play HLS directly; nothing else to load.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      return;
    }

    try {
      const { default: Hls } = await import('hls.js');
      if (!Hls.isSupported()) {
        setFailed(true);
        return;
      }
      const hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setFailed(true);
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    } catch {
      setFailed(true);
    }
  }, [hlsUrl]);

  useEffect(() => {
    if (started) void attach();
  }, [attach, started]);

  // Only set a `src` when we are falling back to the MP4; hls.js drives the
  // element itself, and giving it a `src` as well confuses playback.
  const source = failed || !hlsUrl ? (previewUrl ?? undefined) : undefined;

  if (!hlsUrl && !previewUrl) {
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
        controls={started}
        playsInline
        preload="none"
        poster={posterUrl ?? undefined}
        src={source}
        className="size-full object-contain"
        aria-label={`Intro video from ${name}`}
      />

      {!started ? (
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            // Attach first, then play, so the source exists by the time it runs.
            void attach().then(() => videoRef.current?.play().catch(() => setFailed(true)));
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
