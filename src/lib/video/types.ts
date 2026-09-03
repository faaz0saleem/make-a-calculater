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
 *   - an HLS ladder, for the profile page hero
 *   - a short muted MP4, for the card that autoplays in the feed
 *   - three thumbnail candidates, of which the tutor picks one
 *
 * Production uses Mux or Cloudflare Stream (SPEC.md §14). Development runs
 * ffmpeg locally. Both sit behind this interface, so the wizard, the feed and
 * the profile page never know which one produced their URLs.
 */

export const INTRO_VIDEO_MIN_SECONDS = 30;
export const INTRO_VIDEO_MAX_SECONDS = 90;

/** How many stills the tutor chooses between. */
export const THUMBNAIL_CANDIDATE_COUNT = 3;

/** The card preview is deliberately short — SPEC.md §4 autoplays 8 seconds. */
export const PREVIEW_SECONDS = 8;

export type TranscodeInput = {
  /** Where the tutor's original upload landed in the public bucket. */
  sourceKey: string;
  /** Namespacing for the outputs. */
  ownerId: string;
  videoId: string;
};

export type TranscodeOutput = {
  /** HLS master playlist key. Played by the profile hero. */
  hlsKey: string;
  /** Short muted MP4 key. Played by the feed card on hover. */
  previewKey: string;
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
