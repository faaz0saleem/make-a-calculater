/**
 * Confirming an email address (SPEC.md §1).
 *
 * The rule this file implements is "nudge, do not gate": nothing here blocks
 * anybody from using the product. The two places a confirmed address is
 * actually required live in `src/lib/auth/verification.ts` and are enforced at
 * the two money boundaries, not here.
 *
 * The token mechanics are the reset flow's, for the same reasons: a stored row,
 * sha256 at rest, single use enforced by a `used_at is null` guard inside the
 * claiming update rather than by a check followed by a write.
 */

import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import { enqueueEmail, emailOrigin } from './email';
import type { DbLike } from './ledger';
import { emailVerifications, users } from './schema';
import { verifyPassword } from '@/lib/auth/password';
import { hashToken, newToken, VERIFY_TTL_HOURS } from '@/lib/auth/tokens';
import { VERIFIED_PURCHASE_THRESHOLD_CENTS } from '@/lib/auth/verification';
import { correlationFor, logEvent } from '@/lib/observability/log';

/** How many confirmation emails one account may ask for in the window below. */
export const VERIFY_MAX_PER_ACCOUNT = 5;
export const VERIFY_WINDOW_MINUTES = 60;

export type VerifyRequestResult =
  | { sent: true }
  | { sent: false; reason: 'already_verified' | 'rate_limited' | 'no_such_user' };

/**
 * Send a confirmation link.
 *
 * Unlike the password reset, this one may say what happened: the caller is
 * always the account's own session or its own signup, so there is nobody to
 * leak the existence of an address to. "Already verified" is genuinely useful
 * information and hiding it would only make the button feel broken.
 */
export async function requestEmailVerification(
  input: { userId: string },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<VerifyRequestResult> {
  const [user] = await database
    .select({ email: users.email, verifiedAt: users.emailVerified })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user?.email) return { sent: false, reason: 'no_such_user' };
  if (user.verifiedAt) return { sent: false, reason: 'already_verified' };

  const [recent] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.userId, input.userId),
        gte(
          emailVerifications.createdAt,
          new Date(now.getTime() - VERIFY_WINDOW_MINUTES * 60_000),
        ),
      ),
    );

  if (Number(recent?.n ?? 0) >= VERIFY_MAX_PER_ACCOUNT) {
    logEvent('auth.verify_rate_limited', { severity: 'warn', userId: input.userId });
    return { sent: false, reason: 'rate_limited' };
  }

  const token = newToken();

  await database.insert(emailVerifications).values({
    userId: input.userId,
    email: user.email,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + VERIFY_TTL_HOURS * 3_600_000),
  });

  await enqueueEmail(
    {
      userId: input.userId,
      idempotencyKey: `verify:${hashToken(token).slice(0, 32)}`,
      correlationId: correlationFor('user', input.userId),
      payload: {
        kind: 'email_verification',
        data: {
          verifyUrl: `${emailOrigin()}/verify-email/${token}`,
          expiresInHours: VERIFY_TTL_HOURS,
          purchaseThresholdCents: VERIFIED_PURCHASE_THRESHOLD_CENTS,
        },
      },
    },
    database,
  );

  logEvent('auth.verify_requested', { userId: input.userId });
  return { sent: true };
}

export type ConfirmResult =
  | { ok: true; email: string; alreadyDone: boolean }
  | { ok: false; message: string };

/**
 * Use a confirmation link.
 *
 * Two guards beyond single use. The address on the row must still be the
 * address on the account — somebody who changed their email twice must not
 * confirm the account by clicking the older of the two links, because that
 * link proves they hold an address they no longer use. And an account that is
 * already verified reports success rather than an error, because a person who
 * clicks the link twice has done nothing wrong.
 */
export async function confirmEmailVerification(
  token: string,
  now = new Date(),
  database = defaultDb,
): Promise<ConfirmResult> {
  const hash = hashToken(token);

  return database.transaction(async (tx) => {
    const claimed = await tx
      .update(emailVerifications)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailVerifications.tokenHash, hash),
          isNull(emailVerifications.usedAt),
          gte(emailVerifications.expiresAt, now),
        ),
      )
      .returning({ userId: emailVerifications.userId, email: emailVerifications.email });

    const row = claimed[0];
    if (!row) {
      return {
        ok: false as const,
        message: 'That link is not usable. Ask for another and use the newest email.',
      };
    }

    const [account] = await tx
      .select({ email: users.email, verifiedAt: users.emailVerified })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);

    if (!account?.email || account.email.toLowerCase() !== row.email.toLowerCase()) {
      return {
        ok: false as const,
        message:
          'That link was sent to a different address than the one on this account. Ask for another from your email settings.',
      };
    }

    if (account.verifiedAt) {
      return { ok: true as const, email: account.email, alreadyDone: true };
    }

    await tx
      .update(users)
      .set({ emailVerified: now, updatedAt: now })
      .where(eq(users.id, row.userId));

    logEvent('auth.email_verified', { userId: row.userId });
    return { ok: true as const, email: account.email, alreadyDone: false };
  });
}

export type ChangeEmailResult = { ok: true } | { ok: false; message: string };

/**
 * Change the address on the account.
 *
 * The current password is required, and that is not ceremony. The email address
 * is the sign-in identifier, so a change made by somebody borrowing an open
 * session would lock the owner out of their own account — and a typo made by
 * the owner themselves would do the same thing by accident. Asking for the
 * password makes both of those a deliberate act by the person who knows it.
 *
 * The new address starts unverified, which is the point: it re-arms the nudge
 * and re-closes the two money gates until somebody proves they can read mail
 * sent there.
 */
export async function changeEmail(
  input: { userId: string; currentPassword: string; newEmail: string },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<ChangeEmailResult> {
  const email = input.newEmail.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    return { ok: false, message: 'That does not look like an email address.' };
  }

  const [user] = await database
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user) return { ok: false, message: 'That account could not be found.' };

  if (!user.passwordHash) {
    return {
      ok: false,
      message:
        'This account signs in with Google, so its address comes from Google. Change it there, or set a password first with "forgot password".',
    };
  }

  const correct = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!correct) return { ok: false, message: 'That is not your current password.' };

  if ((user.email ?? '').toLowerCase() === email) {
    return { ok: false, message: 'That is the address you already have.' };
  }

  const [taken] = await database
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  // Same wording as signup, for the same reason: this endpoint is not a way to
  // find out which addresses have accounts.
  if (taken) return { ok: false, message: 'That email cannot be used.' };

  await database
    .update(users)
    .set({ email, emailVerified: null, updatedAt: now })
    .where(eq(users.id, input.userId));

  logEvent('auth.email_changed', { userId: input.userId });

  await requestEmailVerification({ userId: input.userId }, now, database);
  return { ok: true };
}

export type VerificationStatus = { email: string; verified: boolean };

/** What the banner, the header and the two money screens all read. */
export async function verificationStatus(
  userId: string,
  database: DbLike = defaultDb,
): Promise<VerificationStatus | null> {
  const [row] = await database
    .select({ email: users.email, verifiedAt: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return { email: row.email ?? '', verified: row.verifiedAt !== null };
}
