import { beforeEach, describe, expect, it } from 'vitest';
import { CryptoError, decryptSecret, encryptSecret, last4, resetKeyCache, safeEqual } from './crypto';

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');

beforeEach(() => {
  process.env.PAYOUT_ENCRYPTION_KEY = KEY_A;
  process.env.DATABASE_URL ??= 'postgres://unused';
  process.env.AUTH_SECRET ??= 'test-secret-at-least-16-chars';
  resetKeyCache();
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips an IBAN', () => {
    const iban = 'PK36SCBL0000001123456702';
    expect(decryptSecret(encryptSecret(iban))).toBe(iban);
  });

  it('produces different ciphertext each time (fresh IV)', () => {
    const first = encryptSecret('12345678');
    const second = encryptSecret('12345678');
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe(decryptSecret(second));
  });

  it('is versioned so keys can be rotated later', () => {
    expect(encryptSecret('x').startsWith('v1.')).toBe(true);
  });

  it('never stores the plaintext anywhere in the encoded value', () => {
    const secret = 'SUPERSECRETACCOUNT';
    expect(encryptSecret(secret)).not.toContain(secret);
  });

  it('refuses a wrong key', () => {
    const encrypted = encryptSecret('12345678');
    process.env.PAYOUT_ENCRYPTION_KEY = KEY_B;
    resetKeyCache();
    expect(() => decryptSecret(encrypted)).toThrow(CryptoError);
  });

  it('refuses tampered ciphertext', () => {
    const parts = encryptSecret('12345678').split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('nope').toString('base64')].join('.');
    expect(() => decryptSecret(tampered)).toThrow(CryptoError);
  });

  it('rejects a malformed value', () => {
    expect(() => decryptSecret('not-encrypted')).toThrow(CryptoError);
  });

  it('rejects a key of the wrong length', () => {
    process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    resetKeyCache();
    expect(() => encryptSecret('x')).toThrow(CryptoError);
  });

  it('refuses to encrypt an empty string', () => {
    expect(() => encryptSecret('')).toThrow(CryptoError);
  });
});

describe('last4', () => {
  it('keeps only the final four characters', () => {
    expect(last4('PK36SCBL0000001123456702')).toBe('6702');
    expect(last4('1234 5678 9012')).toBe('9012');
  });

  it('pads a short number rather than leaking all of it', () => {
    expect(last4('12')).toBe('**12');
  });
});

describe('safeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
