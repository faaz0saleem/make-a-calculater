/**
 * Getting back into an account, and changing the way in (SPEC.md §1).
 *
 * Three operations and one invariant. The invariant: **none of this touches
 * money.** A reset does not move credits, cancel bookings, release escrow or
 * clear a payout method. Somebody recovering their account should find it
 * exactly as they left it, and an attacker who somehow completes a reset should
 * not thereby be able to change where a payout goes without also knowing the
 * old password. The payout-method screen asks for its own confirmation for that
 * reason, and this file changes nothing but `password_hash` and
 * `sessions_valid_from`.
 */

import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import { enqueueEmail, emailOrigin } from './email';
import type { DbLike } from './ledger';
import { passwordResets, users } from './schema';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { passwordProblem } from '@/lib/auth/password-rules';
import { hashToken, newToken, RESET_TTL_MINUTES } from '@/lib/auth/tokens';
import { correlationFor, logEvent } from '@/lib/observability/log';

/** How many resets one account may ask for in the window below. */
export const RESET_MAX_PER_ADDRESS = 3;
export const RESET_ADDRESS_WINDOW_MINUTES = 15;

/**
 * Ask for a reset link.
 *
 * Returns nothing useful on purpose. The caller renders the same page whether
 * the address exists, does not exist, or has asked too often — because the
 * alternative is an endpoint that tells a stranger which of your users are
 * real. The rate limiting that actually protects the mailbox is per address
 * here and per IP at the route; neither alone is enough. Address alone lets one
 * machine walk a list of addresses; IP alone lets a botnet mail-bomb one person.
 */
export async function requestPasswordReset(
  input: { email: string; ip?: string | null },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<void> {
  const email = input.email.trim().toLowerCase();

  const [user] = await database
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  // No such address. Nothing is written, nothing is sent, and the caller says
  // exactly what it would have said otherwise.
  if (!user) {
    logEvent('auth.reset_requested_unknown', { severity: 'info' });
    return;
  }

  const [recent] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.userId, user.id),
        gte(
          passwordResets.createdAt,
          new Date(now.getTime() - RESET_ADDRESS_WINDOW_MINUTES * 60_000),
        ),
      ),
    );

  if (Number(recent?.n ?? 0) >= RESET_MAX_PER_ADDRESS) {
    // Deliberately silent to the caller. Somebody hammering this is either an
    // attacker or a person clicking twice; neither is helped by an error, and
    // one of them is helped by knowing the address exists.
    logEvent('auth.reset_rate_limited', { severity: 'warn', userId: user.id });
    return;
  }

  const token = newToken();

  await database.insert(passwordResets).values({
    userId: user.id,
    tokenHash: hashToken(token),
    requestedIp: input.ip ?? null,
    expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000),
  });

  await enqueueEmail(
    {
      userId: user.id,
      // Every request is its own email: somebody who asked twice because the
      // first did not arrive needs the second one to send.
      idempotencyKey: `reset:${hashToken(token).slice(0, 32)}`,
      correlationId: correlationFor('user', user.id),
      payload: {
        kind: 'password_reset',
        data: {
          resetUrl: `${emailOrigin()}/reset-password/${token}`,
          expiresInMinutes: RESET_TTL_MINUTES,
          requestedFrom: input.ip ?? null,
        },
      },
    },
    database,
  );

  logEvent('auth.reset_requested', { userId: user.id });
}

export type ResetOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'weak'; message: string };

/**
 * Use a reset link.
 *
 * The claim, the password change and the session invalidation are one
 * transaction. Two clicks on the same link — a person, then their mail
 * provider's link scanner — must not both succeed, and the `used_at is null`
 * in the update is what decides that rather than a check followed by a write.
 */
export async function completePasswordReset(
  input: { token: string; password: string },
  now = new Date(),
  database = defaultDb,
): Promise<ResetOutcome> {
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, reason: 'weak', message: problem };

  const hash = hashToken(input.token);
  const passwordHash = await hashPassword(input.password);

  return database.transaction(async (tx) => {
    const claimed = await tx
      .update(passwordResets)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResets.tokenHash, hash),
          isNull(passwordResets.usedAt),
          gte(passwordResets.expiresAt, now),
        ),
      )
      .returning({ userId: passwordResets.userId });

    const row = claimed[0];
    if (!row) {
      // Unknown, used and expired are one message. Which of the three it was
      // is information about somebody else's link.
      return {
        ok: false as const,
        reason: 'invalid' as const,
        message: 'That link is not usable. Ask for another and use the newest email.',
      };
    }

    await tx
      .update(users)
      .set({
        passwordHash,
        // Everything issued before now stops working, including whatever an
        // intruder was holding.
        sessionsValidFrom: now,
        updatedAt: now,
      })
      .where(eq(users.id, row.userId));

    // Any other link in flight dies with it.
    await tx
      .update(passwordResets)
      .set({ usedAt: now })
      .where(and(eq(passwordResets.userId, row.userId), isNull(passwordResets.usedAt)));

    logEvent('auth.reset_completed', { userId: row.userId });
    return { ok: true as const };
  });
}

export type ChangeOutcome =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Change a password while signed in.
 *
 * The current password is required, which is the whole point: a session left
 * open on a shared computer is not authority to lock its owner out. On success
 * every *other* session is dropped and this one keeps working — being signed
 * out of the device you are typing on is a bad way to learn that the change
 * succeeded.
 */
export async function changePassword(
  input: { userId: string; currentPassword: string; newPassword: string },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<ChangeOutcome> {
  const [user] = await database
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user) return { ok: false, message: 'That account could not be found.' };

  // An account created through Google has no password to confirm. Setting one
  // is a different flow — it needs a verified address, not a current password.
  if (!user.passwordHash) {
    return {
      ok: false,
      message:
        'This account signs in with Google and has no password yet. Use "forgot password" to set one.',
    };
  }

  const correct = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!correct) return { ok: false, message: 'That is not your current password.' };

  const problem = passwordProblem(input.newPassword);
  if (problem) return { ok: false, message: problem };

  if (input.currentPassword === input.newPassword) {
    return { ok: false, message: 'That is the password you already have.' };
  }

  await database
    .update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      sessionsValidFrom: now,
      updatedAt: now,
    })
    .where(eq(users.id, input.userId));

  logEvent('auth.password_changed', { userId: input.userId });
  return { ok: true };
}

/**
 * The three facts about an account that a session cannot be trusted to carry.
 *
 * Read once per request, from the database, by `currentUser()`.
 *
 * All three were previously answered by the token, and two of them wrongly.
 * The JWT is signed at sign-in and then believed for up to thirty days, so a
 * role taken away, an account suspended, or a password reset elsewhere had no
 * effect until it expired. `sessions_valid_from` was already read here; roles
 * and suspension have joined it, in the same query, so the fix costs nothing.
 *
 * `roles` in particular: the token's copy is what every `requireRole` check
 * used to read, which meant demoting an admin left them an admin.
 */
export type AccountFacts = {
  sessionsValidFrom: Date | null;
  suspendedAt: Date | null;
  roles: string[];
};

export async function accountFacts(
  userId: string,
  database: DbLike = defaultDb,
): Promise<AccountFacts | null> {
  const [row] = await database
    .select({
      sessionsValidFrom: users.sessionsValidFrom,
      suspendedAt: users.suspendedAt,
      roles: users.roles,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  return {
    sessionsValidFrom: row.sessionsValidFrom ?? null,
    suspendedAt: row.suspendedAt ?? null,
    roles: (row.roles ?? []) as string[],
  };
}
