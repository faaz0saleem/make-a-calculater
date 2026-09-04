/**
 * The in-app bell (SPEC.md §11).
 *
 * Phase 5 produces the events; Phase 7 adds the email templates that will read
 * from the same rows. Everything here is deliberately dumb — a row, a title, a
 * link — because a notification that carries logic is a notification that can
 * be wrong twice.
 *
 * `dedupeKey` is what stops a tutor saving their calendar three times before
 * breakfast from sending a follower three identical pieces of news.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { notifications } from './schema';

export type NotificationKind = (typeof notifications.kind.enumValues)[number];

export type NewNotification = {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  /** Omit for something that should always arrive. */
  dedupeKey?: string | null;
};

/** Write one. Returns false when the dedupe key had already been used. */
export async function notify(
  notification: NewNotification,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const rows = await database
    .insert(notifications)
    .values({
      userId: notification.userId,
      kind: notification.kind,
      title: notification.title,
      body: notification.body ?? null,
      href: notification.href ?? null,
      dedupeKey: notification.dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });

  return rows.length > 0;
}

/** Write many, skipping any whose dedupe key has already been used. */
export async function notifyMany(
  items: NewNotification[],
  database: DbLike = defaultDb,
): Promise<number> {
  if (items.length === 0) return 0;

  const rows = await database
    .insert(notifications)
    .values(
      items.map((item) => ({
        userId: item.userId,
        kind: item.kind,
        title: item.title,
        body: item.body ?? null,
        href: item.href ?? null,
        dedupeKey: item.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });

  return rows.length;
}

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export async function listNotifications(
  userId: string,
  limit = 30,
  database: DbLike = defaultDb,
): Promise<NotificationRow[]> {
  return database
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(userId: string, database: DbLike = defaultDb): Promise<number> {
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return row?.total ?? 0;
}

/** Marking read is scoped by user id, so nobody can clear somebody else's bell. */
export async function markNotificationsRead(
  userId: string,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<void> {
  await database
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
