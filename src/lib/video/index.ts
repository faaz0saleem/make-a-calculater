/**
 * Choosing a transcoder.
 *
 * Development runs ffmpeg locally. Production needs a hosted service — Vercel
 * has no ffmpeg, and transcoding inside a request handler would be the wrong
 * shape even if it did. SPEC.md §14 names Mux or Cloudflare Stream; which one
 * is an account decision, so it is written up in DECISIONS_NEEDED.md rather
 * than guessed at here.
 *
 * Until that is decided, a deployment without ffmpeg reports the video as
 * failed with a message the tutor can act on, instead of throwing a 500 into
 * the middle of the wizard.
 */

import { FfmpegVideoPipeline } from './ffmpeg';
import type { VideoPipeline } from './types';

export * from './types';
export { FfmpegVideoPipeline } from './ffmpeg';

let cached: VideoPipeline | null = null;
let availability: boolean | null = null;

export function getVideoPipeline(): VideoPipeline {
  cached ??= new FfmpegVideoPipeline();
  return cached;
}

/** Cached because it shells out; the answer cannot change while the app runs. */
export async function isVideoPipelineAvailable(): Promise<boolean> {
  availability ??= await getVideoPipeline().isAvailable();
  return availability;
}

export const VIDEO_PIPELINE_UNAVAILABLE_MESSAGE =
  'Video processing is not configured on this deployment yet, so your clip could not be prepared. ' +
  'Your upload was kept — try again once a transcoder is connected.';

/** Only for tests. */
export function resetVideoPipeline(): void {
  cached = null;
  availability = null;
}
