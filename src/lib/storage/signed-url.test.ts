import { beforeEach, describe, expect, it } from 'vitest';

import { resetEnvCache } from '@/lib/env';
import { ObjectKeyError } from './keys';
import { signObjectPath, SIGNED_URL_TTL_SECONDS, verifyObjectSignature } from './signed-url';

const KEY = 'credentials/11111111-1111-4111-8111-111111111111/doc.pdf';
const NOW = Date.UTC(2026, 3, 15, 12, 0, 0);

beforeEach(() => {
  process.env.DATABASE_URL ??= 'postgres://unused';
  process.env.PAYOUT_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  process.env.AUTH_SECRET = 'test-signing-secret-at-least-16-chars';
  resetEnvCache();
});

function parse(path: string): { exp: string; sig: string } {
  const url = new URL(path, 'http://localhost');
  return { exp: url.searchParams.get('exp')!, sig: url.searchParams.get('sig')! };
}

describe('signObjectPath', () => {
  it('points at the file route and carries an expiry and a signature', () => {
    const path = signObjectPath(KEY, SIGNED_URL_TTL_SECONDS, NOW);
    expect(path.startsWith(`/api/files/${KEY}?`)).toBe(true);

    const { exp, sig } = parse(path);
    expect(Number(exp)).toBe(Math.floor(NOW / 1000) + 60);
    expect(sig.length).toBeGreaterThan(20);
  });

  it('expires in 60 seconds by default, as SPEC.md §13.5 requires', () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(60);
    const { exp } = parse(signObjectPath(KEY, undefined, NOW));
    expect(Number(exp) - Math.floor(NOW / 1000)).toBe(60);
  });

  it('refuses to sign a key that could escape its bucket', () => {
    expect(() => signObjectPath('credentials/../../etc/passwd')).toThrow(ObjectKeyError);
    expect(() => signObjectPath('/etc/passwd')).toThrow(ObjectKeyError);
  });

  it('signs the key, so a signature cannot be reused for another file', () => {
    const path = signObjectPath(KEY, 60, NOW);
    const { exp, sig } = parse(path);
    const otherKey = 'credentials/22222222-2222-4222-8222-222222222222/doc.pdf';
    expect(verifyObjectSignature(otherKey, exp, sig, NOW).ok).toBe(false);
  });
});

describe('verifyObjectSignature', () => {
  it('accepts a fresh signature', () => {
    const { exp, sig } = parse(signObjectPath(KEY, 60, NOW));
    expect(verifyObjectSignature(KEY, exp, sig, NOW)).toEqual({ ok: true });
  });

  it('rejects a missing signature or expiry', () => {
    const { exp, sig } = parse(signObjectPath(KEY, 60, NOW));
    expect(verifyObjectSignature(KEY, null, null, NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyObjectSignature(KEY, exp, null, NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyObjectSignature(KEY, null, sig, NOW)).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a tampered signature', () => {
    const { exp, sig } = parse(signObjectPath(KEY, 60, NOW));
    const tampered = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyObjectSignature(KEY, exp, tampered, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a stretched expiry — the expiry is inside the signature', () => {
    const { exp, sig } = parse(signObjectPath(KEY, 60, NOW));
    const later = String(Number(exp) + 86_400);
    expect(verifyObjectSignature(KEY, later, sig, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a signature that has expired', () => {
    const { exp, sig } = parse(signObjectPath(KEY, 60, NOW));
    expect(verifyObjectSignature(KEY, exp, sig, NOW + 59_000).ok).toBe(true);
    expect(verifyObjectSignature(KEY, exp, sig, NOW + 60_000)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyObjectSignature(KEY, exp, sig, NOW + 3_600_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a malformed expiry without throwing', () => {
    const { sig } = parse(signObjectPath(KEY, 60, NOW));
    for (const bad of ['', 'soon', '-1', '1e9', '9'.repeat(40)]) {
      expect(verifyObjectSignature(KEY, bad, sig, NOW).ok).toBe(false);
    }
  });

  it('rejects a malformed key', () => {
    const { exp, sig } = parse(signObjectPath(KEY, 60, NOW));
    expect(verifyObjectSignature('../../etc/passwd', exp, sig, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a signature minted under a different secret', () => {
    const { exp, sig } = parse(signObjectPath(KEY, 60, NOW));
    process.env.AUTH_SECRET = 'a-completely-different-secret-value';
    resetEnvCache();
    expect(verifyObjectSignature(KEY, exp, sig, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });
});
