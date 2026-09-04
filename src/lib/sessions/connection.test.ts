import { describe, expect, it } from 'vitest';

import {
  assessConnection,
  AUDIO_FLOOR_KBPS,
  canStartSession,
  deviceProblem,
  HIGH_LATENCY_MS,
  HIGH_LOSS_PERCENT,
  VIDEO_FLOOR_KBPS,
} from './connection';

const sample = (downlinkKbps: number, rttMs: number | null = 60, packetLossPercent: number | null = 0) => ({
  downlinkKbps,
  rttMs,
  packetLossPercent,
});

describe('assessConnection', () => {
  it('passes a healthy connection', () => {
    const verdict = assessConnection(sample(3_000));
    expect(verdict.grade).toBe('good');
    expect(verdict.startAudioOnly).toBe(false);
    expect(verdict.blockJoin).toBe(false);
  });

  it('recommends audio only between the two floors', () => {
    const verdict = assessConnection(sample(300));
    expect(verdict.grade).toBe('audio_only');
    expect(verdict.startAudioOnly).toBe(true);
    expect(verdict.blockJoin).toBe(false);
  });

  it('blocks below the voice floor, and says nobody has been charged', () => {
    const verdict = assessConnection(sample(80));
    expect(verdict.grade).toBe('too_weak');
    expect(verdict.blockJoin).toBe(true);
    expect(verdict.detail).toContain('not been charged');
  });

  it('names the measured speed, so the advice is checkable', () => {
    expect(assessConnection(sample(90)).detail).toContain('90 kbps');
  });

  it('blocks on heavy packet loss however fast the line is', () => {
    const verdict = assessConnection(sample(5_000, 40, HIGH_LOSS_PERCENT + 1));
    expect(verdict.grade).toBe('too_weak');
    expect(verdict.blockJoin).toBe(true);
    expect(verdict.detail).toContain('breaks up audio');
  });

  it('tolerates the loss a mobile network normally has', () => {
    // 5% loss is the target in the brief; it must not block a session.
    expect(assessConnection(sample(2_000, 120, 5)).grade).toBe('good');
  });

  it('drops to audio only on high latency', () => {
    const verdict = assessConnection(sample(5_000, HIGH_LATENCY_MS + 1));
    expect(verdict.grade).toBe('audio_only');
    expect(verdict.detail).toContain('talking over each');
  });

  it('accepts the 300ms latency the brief calls normal', () => {
    expect(assessConnection(sample(2_000, 300)).grade).toBe('good');
  });

  it('handles an unmeasured latency or loss without blocking', () => {
    expect(assessConnection(sample(2_000, null, null)).grade).toBe('good');
  });

  it('treats the floors as inclusive on the good side', () => {
    expect(assessConnection(sample(AUDIO_FLOOR_KBPS)).grade).toBe('audio_only');
    expect(assessConnection(sample(AUDIO_FLOOR_KBPS - 1)).grade).toBe('too_weak');
    expect(assessConnection(sample(VIDEO_FLOOR_KBPS)).grade).toBe('good');
    expect(assessConnection(sample(VIDEO_FLOOR_KBPS - 1)).grade).toBe('audio_only');
  });
});

describe('canStartSession', () => {
  const good = assessConnection(sample(3_000));
  const weak = assessConnection(sample(50));

  it('needs a microphone', () => {
    expect(canStartSession({ microphone: 'ok', camera: 'ok' }, good)).toBe(true);
    expect(canStartSession({ microphone: 'denied', camera: 'ok' }, good)).toBe(false);
    expect(canStartSession({ microphone: 'missing', camera: 'ok' }, good)).toBe(false);
  });

  it('does not need a camera', () => {
    expect(canStartSession({ microphone: 'ok', camera: 'missing' }, good)).toBe(true);
    expect(canStartSession({ microphone: 'ok', camera: 'denied' }, good)).toBe(true);
  });

  it('refuses when the connection is too weak', () => {
    expect(canStartSession({ microphone: 'ok', camera: 'ok' }, weak)).toBe(false);
  });
});

describe('deviceProblem', () => {
  it('explains how to fix a blocked microphone', () => {
    expect(deviceProblem({ microphone: 'denied', camera: 'ok' })).toContain('address bar');
  });

  it('suggests a phone when there is no microphone at all', () => {
    expect(deviceProblem({ microphone: 'missing', camera: 'ok' })).toContain('join from a phone');
  });

  it('treats a blocked camera as survivable', () => {
    expect(deviceProblem({ microphone: 'ok', camera: 'denied' })).toContain('voice only');
  });

  it('says nothing when everything works', () => {
    expect(deviceProblem({ microphone: 'ok', camera: 'ok' })).toBeNull();
  });
});
