/**
 * Judging a connection before a session starts (SPEC.md §7).
 *
 * The point of this is money, not polish. A student on a weak connection who
 * joins anyway may end up with a session that fails the 50%-overlap test — and
 * while `resolveBookingOutcome` would refund them, they have still lost the
 * hour they set aside and the tutor has lost the slot. Better to say so before
 * anyone's credits are at stake.
 *
 * Pure, so the thresholds are visible and testable rather than buried in a
 * component.
 */

export type ConnectionSample = {
  /** Measured downlink, in kilobits per second. */
  downlinkKbps: number;
  /** Round-trip time in milliseconds, if measured. */
  rttMs: number | null;
  /** Observed packet loss as a percentage, if measured. */
  packetLossPercent: number | null;
};

export type ConnectionVerdict = {
  grade: 'good' | 'audio_only' | 'too_weak';
  /** What to tell the user, in their terms. */
  headline: string;
  detail: string;
  /** Whether the classroom should start with the camera off. */
  startAudioOnly: boolean;
  /** Whether joining should be discouraged outright. */
  blockJoin: boolean;
};

/**
 * Thresholds.
 *
 * Opus voice needs about 40 kbps; VP8 at 360p needs roughly 500. The gap
 * between them is where a session works as a phone call and fails as a video
 * call, which is exactly the case worth naming rather than discovering
 * mid-lesson.
 */
export const AUDIO_FLOOR_KBPS = 150;
export const VIDEO_FLOOR_KBPS = 600;
/** Beyond this, conversation starts to talk over itself. */
export const HIGH_LATENCY_MS = 400;
/** Beyond this, audio breaks up regardless of bandwidth. */
export const HIGH_LOSS_PERCENT = 8;

export function assessConnection(sample: ConnectionSample): ConnectionVerdict {
  const { downlinkKbps, rttMs, packetLossPercent } = sample;

  if (downlinkKbps < AUDIO_FLOOR_KBPS) {
    return {
      grade: 'too_weak',
      headline: 'Your connection is too weak for a live session',
      detail:
        `We measured about ${Math.round(downlinkKbps)} kbps, and a voice call needs at least ${AUDIO_FLOOR_KBPS}. ` +
        'Try moving closer to your router, switching to mobile data, or rescheduling — you have not been charged.',
      startAudioOnly: true,
      blockJoin: true,
    };
  }

  if (packetLossPercent !== null && packetLossPercent > HIGH_LOSS_PERCENT) {
    return {
      grade: 'too_weak',
      headline: 'Your connection is dropping too much data',
      detail:
        `About ${packetLossPercent.toFixed(0)}% of packets are being lost, which breaks up audio however fast the ` +
        'line is. Try a different network before starting — you have not been charged.',
      startAudioOnly: true,
      blockJoin: true,
    };
  }

  if (downlinkKbps < VIDEO_FLOOR_KBPS) {
    return {
      grade: 'audio_only',
      headline: 'Good enough for voice, not for video',
      detail:
        `We measured about ${Math.round(downlinkKbps)} kbps. We will start you with your camera off so the ` +
        'audio stays clear. You can turn it on during the session if things improve.',
      startAudioOnly: true,
      blockJoin: false,
    };
  }

  if (rttMs !== null && rttMs > HIGH_LATENCY_MS) {
    return {
      grade: 'audio_only',
      headline: 'Your connection is fast but slow to respond',
      detail:
        `A round trip is taking about ${Math.round(rttMs)}ms, so you may find yourselves talking over each ` +
        'other. Starting with video off usually helps.',
      startAudioOnly: true,
      blockJoin: false,
    };
  }

  return {
    grade: 'good',
    headline: 'Your connection looks good',
    detail: 'Video and audio should both be fine.',
    startAudioOnly: false,
    blockJoin: false,
  };
}

export type DeviceCheck = {
  microphone: 'ok' | 'denied' | 'missing';
  camera: 'ok' | 'denied' | 'missing';
};

/** Whether a session can go ahead at all: no microphone means no lesson. */
export function canStartSession(devices: DeviceCheck, verdict: ConnectionVerdict): boolean {
  return devices.microphone === 'ok' && !verdict.blockJoin;
}

export function deviceProblem(devices: DeviceCheck): string | null {
  if (devices.microphone === 'denied') {
    return 'We cannot hear you: your browser is blocking microphone access. Allow it in the address bar, then check again.';
  }
  if (devices.microphone === 'missing') {
    return 'No microphone found. A lesson needs one — plug one in, or join from a phone.';
  }
  if (devices.camera === 'denied') {
    return 'Camera access is blocked. You can still take the lesson with voice only.';
  }
  return null;
}
