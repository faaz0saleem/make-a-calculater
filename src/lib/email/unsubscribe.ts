/**
 * A link that works without signing in (SPEC.md §11).
 *
 * An unsubscribe link that asks for a password is not an unsubscribe link. It
 * is read on a phone, in a mail client, by somebody who is annoyed — and if it
 * does not work in one tap they mark the message as spam instead, which costs
 * the sending domain far more than the preference did.
 *
 * So the token carries its own authority: an HMAC over the user id and the
 * kind, keyed on `AUTH_SECRET`. No table, nothing to clean up, and nothing an
 * attacker can do with a guessed token beyond turning off somebody's own
 * reminders — which is why the token only ever unsubscribes and can never
 * subscribe, read anything, or reach an operational message.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '../env';
import { isEmailKind, type EmailKind } from './kinds';

/** `all` turns off every optional message at once. */
export type UnsubscribeTarget = EmailKind | 'all';

function signature(userId: string, target: UnsubscribeTarget): string {
  return createHmac('sha256', getEnv().AUTH_SECRET)
    .update(`unsubscribe:${userId}:${target}`)
    .digest('base64url');
}

export function unsubscribeToken(userId: string, target: UnsubscribeTarget): string {
  return `${Buffer.from(`${userId}:${target}`).toString('base64url')}.${signature(userId, target)}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { userId: string; target: UnsubscribeTarget } | null {
  const [payload, provided] = token.split('.');
  if (!payload || !provided) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const separator = decoded.lastIndexOf(':');
  if (separator <= 0) return null;

  const userId = decoded.slice(0, separator);
  const target = decoded.slice(separator + 1);
  if (target !== 'all' && !isEmailKind(target)) return null;

  const expected = Buffer.from(signature(userId, target as UnsubscribeTarget));
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  return { userId, target: target as UnsubscribeTarget };
}
