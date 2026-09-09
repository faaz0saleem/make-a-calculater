import { describe, expect, it } from 'vitest';

import { hashToken, newToken, RESET_TTL_MINUTES, tokenHashEquals, VERIFY_TTL_HOURS } from './tokens';

/**
 * These four functions stand between a stranger and somebody's account, so the
 * properties are pinned rather than assumed: unguessable, never stored in the
 * clear, stable to hash, and safe to compare.
 */
describe('one-time link tokens', () => {
  it('mints a fresh token every time', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newToken()));
    expect(seen.size).toBe(500);
  });

  it('mints 192 bits, url-safe', () => {
    for (let i = 0; i < 50; i += 1) {
      const token = newToken();
      // 24 bytes in base64url is 32 characters with no padding.
      expect(token).toHaveLength(32);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      // A token that needed escaping would break the moment it met a URL.
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it('hashes to hex sha256, and the token is not recoverable from it', () => {
    const token = newToken();
    const hash = hashToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    // Same input, same row: the lookup is by hash, so this has to be stable.
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(`${token}x`)).not.toBe(hash);
  });

  it('compares equal hashes and refuses unequal or malformed ones', () => {
    const hash = hashToken('abc');

    expect(tokenHashEquals(hash, hashToken('abc'))).toBe(true);
    expect(tokenHashEquals(hash, hashToken('abd'))).toBe(false);
    // A value out of a URL can be any length. `timingSafeEqual` throws on a
    // length mismatch, so the guard is the difference between `false` and a 500.
    expect(tokenHashEquals(hash, 'short')).toBe(false);
    expect(tokenHashEquals(hash, '')).toBe(false);
  });

  it('expires a reset sooner than a confirmation, on purpose', () => {
    // A reset hands over an account and should be short. Confirming an address
    // is not urgent and people read mail the next morning.
    expect(RESET_TTL_MINUTES).toBe(30);
    expect(VERIFY_TTL_HOURS * 60).toBeGreaterThan(RESET_TTL_MINUTES);
  });
});
