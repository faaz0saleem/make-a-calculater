/**
 * One-time tokens for links people click (SPEC.md §1).
 *
 * Password resets and email confirmations. Deliberately *not* the HMAC scheme
 * the unsubscribe link uses: an unsubscribe token only ever turns something
 * off, so a stateless signature is fine, while these two hand over an account
 * and an identity. They have to be revocable, single-use and expiring, which
 * means a stored row.
 *
 * The row stores a sha256 of the token, never the token. A database dump, a
 * read replica or a support tool with `select *` should not contain working
 * keys to anybody's account. sha256 rather than bcrypt on purpose: the input is
 * 192 bits of randomness we generated, not a human's password, so there is
 * nothing to brute force and no reason to make verification slow.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 24 bytes = 192 bits. Long enough that guessing is not a strategy. */
const TOKEN_BYTES = 24;

/** Half an hour. Long enough to find the email, short enough to matter. */
export const RESET_TTL_MINUTES = 30;

/** A day. Confirming an address is not urgent, and people read mail late. */
export const VERIFY_TTL_HOURS = 24;

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compare two hashes without leaking where they differ.
 *
 * Both sides are hex sha256, so lengths always match; the guard is there for
 * the case where a malformed value reaches this from a URL.
 */
export function tokenHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
