/**
 * The development transcoder: ffmpeg on the machine running the app.
 *
 * Production does not use this — Vercel has no ffmpeg, and transcoding in a
 * request handler would be wrong anyway. `HostedVideoPipeline` covers that.
 * This exists so the whole intro-video flow is buildable and testable locally
 * without an account with anybody.
 *
 * It pulls the upload out of the object store into a temporary directory, runs
 * ffmpeg, and puts the outputs back. The temporary directory is always removed.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { getObjectStore } from '@/lib/storage';
import {
  previewStartSeconds,
  PREVIEW_SECONDS,
  thumbnailTimestamps,
  VideoPipelineError,
  type ProbeResult,
  type TranscodeInput,
  type TranscodeOutput,
  type VideoPipeline,
} from './types';

const run = promisify(execFile);

/** Transcoding a 90-second clip should take seconds, not minutes. */
const FFMPEG_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export class FfmpegVideoPipeline implements VideoPipeline {
  readonly name = 'ffmpeg';

  private readonly ffmpeg: string;
  private readonly ffprobe: string;

  constructor(options: { ffmpegPath?: string; ffprobePath?: string } = {}) {
    this.ffmpeg = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
    this.ffprobe = options.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await run(this.ffmpeg, ['-version'], { timeout: 10_000 });
      await run(this.ffprobe, ['-version'], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async probe(sourceKey: string): Promise<ProbeResult> {
    const workspace = await mkdtemp(join(tmpdir(), 'tutorly-probe-'));
    try {
      const sourcePath = await this.pullSource(sourceKey, workspace);
      return await this.probeFile(sourcePath);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  async transcode(input: TranscodeInput): Promise<TranscodeOutput> {
    const workspace = await mkdtemp(join(tmpdir(), 'tutorly-transcode-'));

    try {
      const sourcePath = await this.pullSource(input.sourceKey, workspace);
      const probe = await this.probeFile(sourcePath);

      const base = `videos/${input.ownerId}/${input.videoId}`;
      const store = getObjectStore();

      // --- HLS ladder -----------------------------------------------------
      // One 720p rendition. A 90-second talking head does not need a ladder of
      // five; more renditions would be cost for no benefit at this length.
      // ffmpeg will not create the segment directory itself.
      const hlsDir = join(workspace, 'hls');
      await mkdir(hlsDir, { recursive: true });

      await run(
        this.ffmpeg,
        [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-i', sourcePath,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          '-vf', 'scale=-2:min(720\\,ih)',
          '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
          '-hls_time', '4',
          '-hls_playlist_type', 'vod',
          '-hls_segment_filename', join(hlsDir, 'segment_%03d.ts'),
          join(hlsDir, 'index.m3u8'),
        ],
        { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      ).catch((error: unknown) => {
        throw new VideoPipelineError('ffmpeg could not produce an HLS rendition', { cause: error });
      });

      for (const file of await readdir(hlsDir)) {
        await this.push(store, `${base}/hls/${file}`, join(hlsDir, file), contentTypeFor(file));
      }

      // --- Card preview ----------------------------------------------------
      // Muted, because the feed autoplays it. Short, because SPEC.md §4 plays
      // eight seconds. MP4 rather than HLS so a card needs no player library.
      const previewPath = join(workspace, 'preview.mp4');
      await run(
        this.ffmpeg,
        [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-ss', String(previewStartSeconds(probe.durationSeconds)),
          '-i', sourcePath,
          '-t', String(PREVIEW_SECONDS),
          '-an',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
          '-vf', 'scale=-2:min(480\\,ih)',
          '-movflags', '+faststart',
          previewPath,
        ],
        { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      ).catch((error: unknown) => {
        throw new VideoPipelineError('ffmpeg could not produce a card preview', { cause: error });
      });

      const previewKey = `${base}/preview.mp4`;
      await this.push(store, previewKey, previewPath, 'video/mp4');

      // --- Thumbnail candidates -------------------------------------------
      const thumbnailKeys: string[] = [];
      for (const [index, at] of thumbnailTimestamps(probe.durationSeconds).entries()) {
        const path = join(workspace, `thumb-${index}.jpg`);
        await run(
          this.ffmpeg,
          [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-ss', String(at),
            '-i', sourcePath,
            '-frames:v', '1',
            '-vf', 'scale=-2:min(720\\,ih)',
            '-q:v', '4',
            path,
          ],
          { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
        ).catch((error: unknown) => {
          throw new VideoPipelineError(`ffmpeg could not extract a thumbnail at ${at}s`, { cause: error });
        });

        const key = `${base}/thumb-${index}.jpg`;
        await this.push(store, key, path, 'image/jpeg');
        thumbnailKeys.push(key);
      }

      return {
        hlsKey: `${base}/hls/index.m3u8`,
        previewKey,
        thumbnailKeys,
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
      };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  private async pullSource(sourceKey: string, workspace: string): Promise<string> {
    const object = await getObjectStore().get('public', sourceKey);
    if (!object) {
      throw new VideoPipelineError(`no uploaded video at ${sourceKey}`);
    }

    const extension = sourceKey.split('.').pop() ?? 'mp4';
    const path = join(workspace, `source.${extension}`);
    await writeFile(path, object.body);
    return path;
  }

  private async probeFile(path: string): Promise<ProbeResult> {
    const { stdout } = await run(
      this.ffprobe,
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:format=duration',
        '-of', 'json',
        path,
      ],
      { timeout: 30_000 },
    ).catch((error: unknown) => {
      throw new VideoPipelineError('ffprobe could not read that file', { cause: error });
    });

    const parsed = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number }[];
      format?: { duration?: string };
    };

    const stream = parsed.streams?.[0];
    const duration = Number(parsed.format?.duration ?? Number.NaN);

    if (!stream?.width || !stream?.height || !Number.isFinite(duration)) {
      throw new VideoPipelineError('that file does not contain a readable video stream');
    }

    return { durationSeconds: duration, width: stream.width, height: stream.height };
  }

  private async push(
    store: ReturnType<typeof getObjectStore>,
    key: string,
    path: string,
    contentType: string,
  ): Promise<void> {
    const body = await readFile(path);
    if (body.byteLength > MAX_OUTPUT_BYTES) {
      throw new VideoPipelineError(`transcoded output ${key} is implausibly large (${body.byteLength} bytes)`);
    }
    await store.put('public', key, new Uint8Array(body), contentType);
  }
}

function contentTypeFor(file: string): string {
  if (file.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (file.endsWith('.ts')) return 'video/mp2t';
  return 'application/octet-stream';
}
