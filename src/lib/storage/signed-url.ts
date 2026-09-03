/**
 * Signed URLs for private objects (SPEC.md §13.5).
 *
 * A credential document is never reachable by guessing a path. An admin opening
 * one gets a URL carrying an expiry and an HMAC over `key|expiry`; the route
 * refuses anything without a valid, unexpired signature.
 *
 * The signing key is derived from `AUTH_SECRET` with a domain separator rather
 * than being another environment variable to set and rotate. Deriving means a
 * file signature can never be confused with a session token even though both
 * ultimately come from the same secret.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '@/lib/env';
import { assertValidObjectKey, isValidObjectKey } from './keys';

/** SPEC.md §13.5: signed URLs expire in 60 seconds. */
export const SIGNED_URL_TTL_SECONDS = 60;

const DERIVATION_LABEL = 'tutorly:file-url:v1';

/**
 * What a signature authorises. A URL signed to read a file must not also be
 * usable to overwrite it, so the operation is part of what gets signed.
 */
export type SignedOperation = 'get' | 'put';

export type SignatureFailure = 'missing' | 'malformed' | 'expired' | 'invalid';

export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

function signingKey(): Buffer {
  return createHmac('sha256', getEnv().AUTH_SECRET).update(DERIVATION_LABEL).digest();
}

function computeSignature(key: string, expiresAt: number, operation: SignedOperation): string {
  // `get` is unprefixed so signatures minted before uploads existed still verify.
  const scope = operation === 'get' ? '' : `${operation}|`;
  return createHmac('sha256', signingKey()).update(`${scope}${key}|${expiresAt}`).digest('base64url');
}

/**
 * A path an admin can open for the next `ttlSeconds`.
 *
 * Returns a path rather than an absolute URL so it works unchanged behind any
 * host — localhost, a preview deployment, or production.
 */
export function signObjectPath(key: string, ttlSeconds = SIGNED_URL_TTL_SECONDS, now = Date.now()): string {
  assertValidObjectKey(key);

  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const signature = computeSignature(key, expiresAt, 'get');
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');

  return `/api/files/${encodedKey}?exp=${expiresAt}&sig=${signature}`;
}

/** How long a browser has to finish a direct upload. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * A path the browser may PUT one specific object to.
 *
 * Used only when there is no R2 to presign against — see
 * `src/lib/storage/direct-upload.ts`.
 */
export function signUploadPath(key: string, ttlSeconds = UPLOAD_URL_TTL_SECONDS, now = Date.now()): string {
  assertValidObjectKey(key);

  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const signature = computeSignature(key, expiresAt, 'put');
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');

  return `/api/uploads/${encodedKey}?exp=${expiresAt}&sig=${signature}`;
}

/**
 * Check a signature. Every failure mode is distinguished for logging, but the
 * route answers all of them with the same 403 so a caller learns nothing about
 * which part they got wrong.
 */
export function verifyObjectSignature(
  key: string,
  expiresAtRaw: string | null,
  signature: string | null,
  now = Date.now(),
  operation: SignedOperation = 'get',
): SignatureCheck {
  if (!expiresAtRaw || !signature) return { ok: false, reason: 'missing' };
  if (!isValidObjectKey(key)) return { ok: false, reason: 'malformed' };

  if (!/^\d{1,15}$/.test(expiresAtRaw)) return { ok: false, reason: 'malformed' };
  const expiresAt = Number(expiresAtRaw);

  const expected = computeSignature(key, expiresAt, operation);
  const provided = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');

  // Compare before checking the clock, and in constant time, so neither the
  // timing nor the order of checks leaks anything about the real signature.
  const matches =
    provided.length === expectedBytes.length && timingSafeEqual(provided, expectedBytes);

  if (!matches) return { ok: false, reason: 'invalid' };
  if (Math.floor(now / 1000) >= expiresAt) return { ok: false, reason: 'expired' };

  return { ok: true };
}
