/**
 * App-level encryption for payout bank details (SPEC.md §2, §13.5).
 *
 * Disk encryption on the database is not enough: anyone with a read replica, a
 * backup, or a `select *` in a support tool would see account numbers. These
 * columns are encrypted by the application, so a database dump is useless
 * without `PAYOUT_ENCRYPTION_KEY`.
 *
 * AES-256-GCM. The stored string is `v1.<iv>.<authTag>.<ciphertext>`, all base64.
 * The version prefix is there so a key rotation can be rolled out gradually.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { getEnv, resetEnvCache } from './env';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12; // 96 bits, the value GCM is specified for
const KEY_BYTES = 32;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = getEnv().PAYOUT_ENCRYPTION_KEY;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `PAYOUT_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. Generate one with: openssl rand -base64 32`,
    );
  }

  cachedKey = key;
  return key;
}

/**
 * Only for tests, which need to swap keys inside one process. The environment
 * snapshot is dropped too — the key is read from it, so caching one without the
 * other would hand back the old key.
 */
export function resetKeyCache(): void {
  cachedKey = null;
  resetEnvCache();
}

export function encryptSecret(plaintext: string): string {
  if (plaintext.length === 0) {
    throw new CryptoError('refusing to encrypt an empty string');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 4) {
    throw new CryptoError('ciphertext is not in the expected v1.iv.tag.data form');
  }

  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new CryptoError(`unknown ciphertext version ${version}`);
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately vague: a tampered tag and a wrong key look the same from here.
    throw new CryptoError('could not decrypt: wrong key or tampered ciphertext');
  }
}

/** The only part of an account number the UI may ever show. */
export function last4(accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, '');
  return digits.slice(-4).padStart(4, '*');
}

/** Constant-time comparison, for anything secret-shaped that is compared. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
