/**
 * The only place `messages.body_raw` is read (SPEC.md §8).
 *
 * Masking is applied on write, so the readable body genuinely has the contact
 * details gone. The raw text is kept because a pattern cannot catch a phone
 * number spelled out in words, and a human reviewing a report needs to see what
 * was actually sent.
 *
 * Everything here demands an admin. The check is inside the function rather
 * than at the route, so a new route cannot forget it — and there is exactly one
 * function to audit.
 */

import { and, desc, eq, gt, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { messages, threads, users } from './schema';
import { isAdmin, type UserRole } from '@/lib/auth/roles';

/** Just enough of a session user to check. */
export type Moderator = { roles: readonly UserRole[] };

export class NotAModerator extends Error {
  constructor() {
    super('reading raw message bodies requires an admin');
    this.name = 'NotAModerator';
  }
}

export type ModeratedMessage = {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  /** What everyone else sees. */
  masked: string;
  /** What was typed. Admin eyes only. */
  raw: string;
  redactions: number;
  createdAt: Date;
};

function assertModerator(viewer: Moderator): void {
  if (!isAdmin(viewer.roles)) throw new NotAModerator();
}

/**
 * Messages that had contact details taken out, newest first.
 *
 * This is the "flagged messages" queue from SPEC.md §10: a message with three
 * redactions in it is the one worth a human's attention.
 */
export async function flaggedMessages(
  viewer: Moderator,
  limit = 50,
  database: DbLike = defaultDb,
): Promise<ModeratedMessage[]> {
  assertModerator(viewer);

  const rows = await database
    .select({
      id: messages.id,
      threadId: messages.threadId,
      senderId: messages.senderId,
      senderName: users.name,
      masked: messages.bodyMasked,
      raw: messages.bodyRaw,
      redactions: messages.redactions,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(gt(messages.redactions, 0))
    .orderBy(desc(messages.redactions), desc(messages.createdAt))
    .limit(limit);

  return rows;
}

/** One thread in full, for investigating a report. */
export async function moderatedThread(
  viewer: Moderator,
  threadId: string,
  database: DbLike = defaultDb,
): Promise<ModeratedMessage[]> {
  assertModerator(viewer);

  return database
    .select({
      id: messages.id,
      threadId: messages.threadId,
      senderId: messages.senderId,
      senderName: users.name,
      masked: messages.bodyMasked,
      raw: messages.bodyRaw,
      redactions: messages.redactions,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(and(eq(messages.threadId, threadId), sql`true`))
    .orderBy(messages.createdAt);
}
