'use client';

/**
 * The pre-call check (SPEC.md §7).
 *
 * A student on a weak line should find out here, before their credits are at
 * stake — not eight minutes into a lesson that is going to fail the
 * 50%-overlap test.
 *
 * Three things are checked: that we can hear them, that we can see them
 * (optional), and how much bandwidth they actually have. The bandwidth number
 * comes from timing a real download from our own origin rather than from
 * `navigator.connection`, which reports the browser's guess and is missing
 * entirely in Safari.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  assessConnection,
  canStartSession,
  deviceProblem,
  type ConnectionVerdict,
  type DeviceCheck,
} from '@/lib/sessions/connection';
import { cn } from '@/lib/utils';

type Phase = 'idle' | 'checking' | 'done' | 'failed';

/** Big enough to time meaningfully, small enough not to cost a student data. */
const PROBE_BYTES = 256 * 1024;
/**
 * The probe gives up after this long and reports what it managed to pull.
 *
 * Without a deadline the check punishes exactly the people it exists for: on a
 * 120 kbps line the full 256 KB takes seventeen seconds, and someone whose
 * connection is about to be called too weak sits watching a spinner to find
 * out. Three seconds is enough to tell 100 kbps from 2 Mbps.
 */
const PROBE_BUDGET_MS = 3_000;

async function measureDownlinkKbps(signal: AbortSignal): Promise<number> {
  const started = performance.now();
  const response = await fetch(`/api/net-probe?bytes=${PROBE_BYTES}&t=${Date.now()}`, {
    cache: 'no-store',
    signal,
  });

  let received = 0;

  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (performance.now() - started >= PROBE_BUDGET_MS) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } else {
    received = (await response.blob()).size;
  }

  const seconds = (performance.now() - started) / 1_000;

  if (seconds <= 0) return Number.POSITIVE_INFINITY;
  return (received * 8) / seconds / 1_000;
}

async function measureRttMs(signal: AbortSignal): Promise<number> {
  const samples: number[] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = performance.now();
    await fetch(`/api/net-probe?bytes=0&t=${Date.now()}-${attempt}`, { cache: 'no-store', signal });
    samples.push(performance.now() - started);
  }

  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

/**
 * Is the classroom service itself reachable?
 *
 * The rest of this check measures a download from *our* origin and a few
 * round trips to it, and then says "Video and audio should both be fine" —
 * which is a claim about LiveKit, a service it never touched. With LiveKit
 * unreachable the verdict was a confident green light on the screen somebody
 * opens for a lesson they have paid for.
 *
 * `/api/health` already probes it. `null` means we could not tell, which is
 * treated as "do not claim either way" rather than as a failure.
 */
async function classroomReachable(signal: AbortSignal): Promise<boolean | null> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal });
    const health = (await response.json()) as { checks?: { livekit?: string } };
    const state = health.checks?.livekit;
    return state === undefined ? null : state === 'up';
  } catch {
    return null;
  }
}

async function checkDevices(): Promise<{ devices: DeviceCheck; stream: MediaStream | null }> {
  const result: DeviceCheck = { microphone: 'missing', camera: 'missing' };
  let stream: MediaStream | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    result.microphone = stream.getAudioTracks().length > 0 ? 'ok' : 'missing';
    result.camera = stream.getVideoTracks().length > 0 ? 'ok' : 'missing';
    return { devices: result, stream };
  } catch {
    // Video may simply be unavailable; audio on its own is enough for a lesson.
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      result.microphone = 'ok';
      result.camera = 'denied';
      return { devices: result, stream };
    } catch {
      result.microphone = 'denied';
      result.camera = 'denied';
      return { devices: result, stream: null };
    }
  }
}

export function PreCallCheck({
  onReady,
  disabled,
  disabledReason,
}: {
  onReady: (options: { audioOnly: boolean }) => void;
  disabled: boolean;
  disabledReason: string | null;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [devices, setDevices] = useState<DeviceCheck | null>(null);
  const [verdict, setVerdict] = useState<ConnectionVerdict | null>(null);
  /** Our own video service, not the viewer's connection. See `classroomReachable`. */
  const [classroomDown, setClassroomDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopPreview = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    stopPreview();
  }, [stopPreview]);

  const run = useCallback(async () => {
    setPhase('checking');
    setError(null);
    setClassroomDown(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { devices: found, stream } = await checkDevices();
      setDevices(found);

      if (stream) {
        stopPreview();
        streamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
      }

      const [downlinkKbps, rttMs, classroom] = await Promise.all([
        measureDownlinkKbps(controller.signal),
        measureRttMs(controller.signal),
        classroomReachable(controller.signal),
      ]);

      setClassroomDown(classroom === false);
      setVerdict(assessConnection({ downlinkKbps, rttMs, packetLossPercent: null }));
      setPhase('done');
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return;
      setError('We could not finish the check. That usually means the connection dropped — try again.');
      setPhase('failed');
    }
  }, [stopPreview]);

  const ready = devices && verdict && canStartSession(devices, verdict);
  const problem = devices ? deviceProblem(devices) : null;

  return (
    <section className="flex flex-col gap-5" aria-labelledby="precall-heading">
      <div>
        <h2 id="precall-heading" className="text-lg font-semibold tracking-tight">
          Check your setup
        </h2>
        <p className="text-sm text-muted-foreground">
          Worth thirty seconds before a lesson you have paid for.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-black">
        <video
          ref={previewRef}
          autoPlay
          muted
          playsInline
          aria-label="Camera preview"
          className="aspect-video w-full object-cover"
        />
      </div>

      {phase === 'idle' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            We will ask for your microphone and camera, then measure your connection.
          </p>
          <Button onClick={() => void run()} className="self-start">
            Run the check
          </Button>
        </div>
      ) : null}

      {phase === 'checking' ? (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <p className="text-sm font-medium">Checking…</p>
          <ol className="flex flex-col gap-1 text-sm text-muted-foreground">
            <li>{devices ? '✓' : '…'} Microphone and camera</li>
            <li>{verdict ? '✓' : '…'} Connection speed</li>
          </ol>
        </div>
      ) : null}

      {phase === 'failed' && error ? (
        <div role="alert" className="flex flex-col gap-3 rounded-md bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void run()} className="self-start">
            Try again
          </Button>
        </div>
      ) : null}

      {phase === 'done' && classroomDown ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <strong>Our video service is not responding.</strong> Your own connection is fine — this
          is at our end. Nothing extra has been charged, and if the session cannot go ahead you are
          refunded in full. Try again in a minute, and tell your tutor if it does not come back.
        </p>
      ) : null}

      {/* Suppressed while the classroom is unreachable. The verdict's best case
          says "Video and audio should both be fine", which is a claim about a
          service that is not answering — two contradictory sentences on one
          screen is worse than one. "Check again" is still below. */}
      {phase === 'done' && verdict && !classroomDown ? (
        <div className="flex flex-col gap-4" role="status" aria-live="polite">
          <div
            className={cn(
              'rounded-md p-3',
              verdict.grade === 'good' && 'bg-[var(--success)]/10',
              verdict.grade === 'audio_only' && 'bg-secondary',
              verdict.grade === 'too_weak' && 'bg-destructive/10',
            )}
          >
            <p
              className={cn(
                'text-sm font-medium',
                verdict.grade === 'too_weak' ? 'text-destructive' : undefined,
              )}
            >
              {verdict.headline}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{verdict.detail}</p>
          </div>

          {problem ? (
            <p
              role="alert"
              className={cn(
                'rounded-md p-3 text-sm',
                devices?.microphone === 'ok' ? 'bg-secondary text-muted-foreground' : 'bg-destructive/10 text-destructive',
              )}
            >
              {problem}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                stopPreview();
                onReady({ audioOnly: verdict.startAudioOnly });
              }}
              disabled={!ready || disabled}
              size="lg"
            >
              {verdict.startAudioOnly ? 'Join with voice only' : 'Join the session'}
            </Button>

            <Button variant="ghost" size="sm" onClick={() => void run()}>
              Check again
            </Button>
          </div>

          {disabled && disabledReason ? (
            <p className="text-sm text-muted-foreground">{disabledReason}</p>
          ) : null}

          {!ready && !disabled ? (
            <p className="text-sm text-muted-foreground">
              Fix the problem above, then check again. Your session has not started and you have not been
              charged.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
