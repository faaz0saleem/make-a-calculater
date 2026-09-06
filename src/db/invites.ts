/**
 * Inviting a tutor by hand (SPEC.md §3, §14).
 *
 * The first ten tutors on a marketplace are not found by a signup form, they
 * are found by somebody having a conversation. This is the path from that
 * conversation to a profile: one link, single use, that lands them on a page
 * which already knows their name and skips the queue their documents would
 * otherwise sit in.
 *
 * What it deliberately does not skip is the rest of the wizard. An invited
 * tutor still says what they teach, what they charge and when they are free —
 * a "verified" profile with none of that is an empty card in the feed, which is
 * the exact failure this phase exists to prevent.
 */

import { createHash, randomBytes } from 'node:crypto';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { tutorInvites, users } from './schema';
import { logEvent } from '@/lib/observability/log';

/** Long enough that guessing is not a strategy; short enough to paste. */
const TOKEN_BYTES = 24;

/** A link somebody has not used in a fortnight is a link they are not going to. */
export const INVITE_TTL_DAYS = 14;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type CreatedInvite = { id: string; token: string; expiresAt: Date };

export async function createTutorInvite(
  input: { email: string; name?: string | null; note?: string | null; adminId: string },
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<{ ok: true; invite: CreatedInvite } | { ok: false; reason: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, reason: 'That does not look like an email address.' };
  }

  // Somebody who already has an account does not need an invite — they need to
  // be told to sign in, which is a different sentence.
  const [existing] = await database
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing) {
    return { ok: false, reason: 'That email already has an account. Ask them to sign in instead.' };
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);

  const [created] = await database
    .insert(tutorInvites)
    .values({
      email,
      name: input.name?.trim() || null,
      tokenHash: hashInviteToken(token),
      invitedBy: input.adminId,
      note: input.note?.trim() || null,
      expiresAt,
    })
    .returning({ id: tutorInvites.id });

  logEvent('invite.created', { inviteId: created!.id, adminId: input.adminId });

  return { ok: true, invite: { id: created!.id, token, expiresAt } };
}

export type OpenInvite = {
  id: string;
  email: string;
  name: string | null;
  preVerified: boolean;
  invitedBy: string;
  expiresAt: Date;
};

/**
 * Look up a live invite by its token.
 *
 * Null for anything that is not currently usable — unknown, expired, or already
 * accepted — because the page should say the same thing for all three. Telling
 * a stranger which of those it was is telling them whether the token existed.
 */
export async function inviteByToken(
  token: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<OpenInvite | null> {
  const [row] = await database
    .select({
      id: tutorInvites.id,
      email: tutorInvites.email,
      name: tutorInvites.name,
      preVerified: tutorInvites.preVerified,
      invitedBy: tutorInvites.invitedBy,
      expiresAt: tutorInvites.expiresAt,
    })
    .from(tutorInvites)
    .where(and(eq(tutorInvites.tokenHash, hashInviteToken(token)), isNull(tutorInvites.acceptedAt)))
    .limit(1);

  if (!row || row.expiresAt <= now) return null;
  return row as OpenInvite;
}

/**
 * Claim it, and refuse to do so twice.
 *
 * The `accepted_at is null` in the where clause is what makes the link single
 * use: two people opening it at the same moment produce one claim and one
 * refusal, decided by the database rather than by a check-then-write. Called
 * *before* the account exists, so a losing race creates no orphan row.
 */
export async function claimInvite(
  inviteId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<boolean> {
  const rows = await database
    .update(tutorInvites)
    .set({ acceptedAt: now })
    .where(and(eq(tutorInvites.id, inviteId), isNull(tutorInvites.acceptedAt)))
    .returning({ id: tutorInvites.id });

  return rows.length > 0;
}

/** Point a claimed invite at the account it produced. */
export async function attachInviteUser(
  inviteId: string,
  userId: string,
  database: DbLike = defaultDb,
): Promise<void> {
  await database
    .update(tutorInvites)
    .set({ acceptedUserId: userId })
    .where(eq(tutorInvites.id, inviteId));
}

export type InviteRow = {
  id: string;
  email: string;
  name: string | null;
  note: string | null;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedUserId: string | null;
  invitedByName: string | null;
};

export async function recentInvites(
  limit = 25,
  database: DbLike = defaultDb,
): Promise<InviteRow[]> {
  return database
    .select({
      id: tutorInvites.id,
      email: tutorInvites.email,
      name: tutorInvites.name,
      note: tutorInvites.note,
      createdAt: tutorInvites.createdAt,
      expiresAt: tutorInvites.expiresAt,
      acceptedAt: tutorInvites.acceptedAt,
      acceptedUserId: tutorInvites.acceptedUserId,
      invitedByName: users.name,
    })
    .from(tutorInvites)
    .innerJoin(users, eq(users.id, tutorInvites.invitedBy))
    .orderBy(desc(tutorInvites.createdAt))
    .limit(limit) as unknown as Promise<InviteRow[]>;
}

/** Withdraw one that has not been used. */
export async function revokeInvite(
  inviteId: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const rows = await database
    .delete(tutorInvites)
    .where(and(eq(tutorInvites.id, inviteId), isNull(tutorInvites.acceptedAt)))
    .returning({ id: tutorInvites.id });

  return rows.length > 0;
}
