/**
 * The intro video pipeline (SPEC.md §3 step 4, §14).
 *
 * Scope, because this is the one place the product could drift: an intro video
 * is a 30-90 second marketing clip. It is the only video asset Tutorly stores.
 * All teaching is live, real-time video or voice — there are no recorded
 * lessons and no course content, and nothing in this module should grow toward
 * a video library.
 *
 * A tutor uploads one file. The pipeline turns it into:
 *   - a small muted MP4, for the card that autoplays in the feed
 *   - a larger MP4, for the profile page hero
 *   - three thumbnail candidates, of which the tutor picks one
 *
 * Two fixed renditions rather than an HLS ladder, deliberately. Adaptive
 * streaming earns its keep on long video where a viewer's bandwidth changes
 * mid-watch; these clips are 30-90 seconds. And the hosted transcoders that
 * produce HLS bill per minute *delivered*, which — with a feed that autoplays
 * previews on hover — scales with browsing rather than with bookings. R2 has no
 * egress charge, so two MP4s served straight from the bucket cost nothing to
 * show and need no player library.
 *
 * SPEC.md §14's Mux / Cloudflare Stream line is superseded by that reasoning.
 */

export const INTRO_VIDEO_MIN_SECONDS = 30;
export const INTRO_VIDEO_MAX_SECONDS = 90;

/** How many stills the tutor chooses between. */
export const THUMBNAIL_CANDIDATE_COUNT = 3;

/** The card preview is deliberately short — SPEC.md §4 autoplays 8 seconds. */
export const PREVIEW_SECONDS = 8;

/** Rendition heights. Small enough to autoplay on a phone, large enough to watch. */
export const PREVIEW_HEIGHT = 360;
export const HERO_HEIGHT = 720;

export type TranscodeInput = {
  /** Where the tutor's original upload landed in the public bucket. */
  sourceKey: string;
  /** Namespacing for the outputs. */
  ownerId: string;
  videoId: string;
};

export type TranscodeOutput = {
  /** Short muted MP4. Played by the feed card on hover. */
  previewKey: string;
  /** Full-length MP4 with audio. Played by the profile hero. */
  heroKey: string;
  /** Three stills; the tutor picks one and it becomes the poster. */
  thumbnailKeys: string[];
  durationSeconds: number;
  width: number;
  height: number;
};

export type ProbeResult = {
  durationSeconds: number;
  width: number;
  height: number;
};

export class VideoPipelineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VideoPipelineError';
  }
}

export interface VideoPipeline {
  readonly name: string;
  /** True when the pipeline can actually run in this environment. */
  isAvailable(): Promise<boolean>;
  probe(sourceKey: string): Promise<ProbeResult>;
  transcode(input: TranscodeInput): Promise<TranscodeOutput>;
}

export type LengthCheck = { ok: true } | { ok: false; reason: string };

/** SPEC.md §3: the clip has to be between 30 and 90 seconds. */
export function checkIntroLength(durationSeconds: number): LengthCheck {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, reason: 'We could not read that video. Try exporting it again as MP4.' };
  }
  // Round so a 29.6-second clip is not rejected for being four tenths short.
  const seconds = Math.round(durationSeconds);
  if (seconds < INTRO_VIDEO_MIN_SECONDS) {
    return { ok: false, reason: `That clip is ${seconds} seconds. Intro videos need to be at least ${INTRO_VIDEO_MIN_SECONDS}.` };
  }
  if (seconds > INTRO_VIDEO_MAX_SECONDS) {
    return { ok: false, reason: `That clip is ${seconds} seconds. Intro videos can be at most ${INTRO_VIDEO_MAX_SECONDS}.` };
  }
  return { ok: true };
}

/**
 * Where to take the three thumbnail candidates from.
 *
 * Evenly spread across the middle of the clip: the first and last moments of a
 * talking-head video are usually someone reaching for the record button.
 */
export function thumbnailTimestamps(durationSeconds: number, count = THUMBNAIL_CANDIDATE_COUNT): number[] {
  const usableStart = durationSeconds * 0.15;
  const usableEnd = durationSeconds * 0.85;
  const span = usableEnd - usableStart;

  return Array.from({ length: count }, (_, index) => {
    const fraction = count === 1 ? 0.5 : index / (count - 1);
    return Math.round((usableStart + span * fraction) * 100) / 100;
  });
}

/** Where the 8-second card preview starts: just after the intro settles. */
export function previewStartSeconds(durationSeconds: number): number {
  return Math.max(0, Math.min(durationSeconds * 0.15, Math.max(0, durationSeconds - PREVIEW_SECONDS)));
}
