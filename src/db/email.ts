/**
 * The email outbox: enqueue, drain, and the preferences that gate it
 * (SPEC.md §11).
 *
 * Nothing in this file sends anything inline. `enqueueEmail` writes a row —
 * inside the caller's transaction when it is given one, so an email about a
 * booking cannot exist without the booking — and `drainEmailQueue` is the only
 * thing that talks to a provider.
 *
 * The gate order is deliberate: address, then account state, then global
 * unsubscribe, then per-kind preference. Each of them produces a `skipped` row
 * carrying the reason, because the question people actually ask is "why did I
 * not get that email?" and a missing row cannot answer it.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { emailDeliveries, emailPreferences, users } from './schema';
import { isOptionalEmail, type EmailKind } from '@/lib/email/kinds';
import type { EmailPayload } from '@/lib/email/render';

/** Where links in an email point. Absolute, because email has no relative. */
export function emailOrigin(): string {
  return (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export type EnqueueEmail = {
  userId: string;
  payload: EmailPayload;
  /** One event, one email. Reused by a retrying job without sending twice. */
  idempotencyKey: string;
  /** After this instant the message is stale and is dropped rather than sent. */
  expiresAt?: Date | null;
  /** The booking, payout or purchase this is about. */
  correlationId?: string | null;
};

/** Why a message was not queued. Every one of these produces a visible row. */
export type SkipReason = 'no_address' | 'suspended' | 'unsubscribed' | 'preference';

export type EnqueueResult =
  | { queued: true; id: string }
  | { queued: false; reason: SkipReason | 'duplicate' };

/**
 * Put one email in the outbox.
 *
 * Returns without queueing when the recipient should not get it, and writes a
 * `skipped` row saying which of the reasons applied — except for a duplicate,
 * which by definition already has a row.
 */
export async function enqueueEmail(
  input: EnqueueEmail,
  database: DbLike = defaultDb,
): Promise<EnqueueResult> {
  const [recipient] = await database
    .select({
      email: users.email,
      name: users.name,
      suspendedAt: users.suspendedAt,
      unsubscribedAt: users.emailUnsubscribedAt,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!recipient) return { queued: false, reason: 'no_address' };

  const optional = isOptionalEmail(input.payload.kind);

  const skip = async (reason: SkipReason) => {
    // A skip is still a record. Rendering it would be wasted work, so the row
    // carries the intention and the reason rather than a document nobody reads.
    await database
      .insert(emailDeliveries)
      .values({
        userId: input.userId,
        kind: input.payload.kind,
        toEmail: recipient.email ?? 'unknown',
        subject: `(not sent: ${reason})`,
        payload: {},
        idempotencyKey: input.idempotencyKey,
        status: 'skipped',
        skipReason: reason,
        correlationId: input.correlationId ?? null,
      })
      .onConflictDoNothing({ target: emailDeliveries.idempotencyKey });

    return { queued: false as const, reason };
  };

  if (!recipient.email) return skip('no_address');
  // A suspended account still hears about its own money and its own appeal, so
  // only the optional half is withheld.
  if (recipient.suspendedAt && optional) return skip('suspended');
  if (recipient.unsubscribedAt && optional) return skip('unsubscribed');

  if (optional) {
    const [preference] = await database
      .select({ enabled: emailPreferences.enabled })
      .from(emailPreferences)
      .where(
        and(
          eq(emailPreferences.userId, input.userId),
          eq(emailPreferences.kind, input.payload.kind),
        ),
      )
      .limit(1);

    // Absent means default, and the default is on.
    if (preference && !preference.enabled) return skip('preference');
  }

  const rows = await database
    .insert(emailDeliveries)
    .values({
      userId: input.userId,
      kind: input.payload.kind,
      toEmail: recipient.email,
      // The intent, not a document. `db/email-queue.ts` renders it when it
      // sends it — see the note on the column.
      payload: input.payload.data as Record<string, unknown>,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt ?? null,
      correlationId: input.correlationId ?? null,
    })
    .onConflictDoNothing({ target: emailDeliveries.idempotencyKey })
    .returning({ id: emailDeliveries.id });

  const created = rows[0];
  if (!created) return { queued: false, reason: 'duplicate' };

  return { queued: true, id: created.id };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export type EmailPreference = { kind: EmailKind; enabled: boolean };

/** Every optional kind with its current setting, defaulting to on. */
export async function preferencesFor(
  userId: string,
  database: DbLike = defaultDb,
): Promise<{ unsubscribedAll: boolean; preferences: EmailPreference[] }> {
  const [user] = await database
    .select({ unsubscribedAt: users.emailUnsubscribedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const rows = await database
    .select({ kind: emailPreferences.kind, enabled: emailPreferences.enabled })
    .from(emailPreferences)
    .where(eq(emailPreferences.userId, userId));

  const stored = new Map(rows.map((row) => [row.kind, row.enabled]));

  return {
    unsubscribedAll: Boolean(user?.unsubscribedAt),
    preferences: [...isOptionalKinds()].map((kind) => ({
      kind,
      enabled: stored.get(kind) ?? true,
    })),
  };
}

function isOptionalKinds(): EmailKind[] {
  return (
    [
      'reminder_24h',
      'reminder_1h',
      'session_starting',
      'session_completed',
      'credits_low',
      'new_review',
      'followed_tutor_slots',
    ] as EmailKind[]
  ).filter(isOptionalEmail);
}

export async function setEmailPreference(
  userId: string,
  kind: EmailKind,
  enabled: boolean,
  database: DbLike = defaultDb,
): Promise<void> {
  if (!isOptionalEmail(kind)) {
    // Not a validation nicety: offering the switch and then ignoring it is how
    // somebody stops trusting every other setting on the page.
    throw new Error(`${kind} is operational and cannot be switched off`);
  }

  await database
    .insert(emailPreferences)
    .values({ userId, kind, enabled })
    .onConflictDoUpdate({
      target: [emailPreferences.userId, emailPreferences.kind],
      set: { enabled, updatedAt: sql`now()` },
    });
}

/** The one-tap link. `all` is the global switch; a kind turns off just that one. */
export async function unsubscribe(
  userId: string,
  target: EmailKind | 'all',
  database: DbLike = defaultDb,
): Promise<void> {
  if (target === 'all') {
    await database
      .update(users)
      .set({ emailUnsubscribedAt: sql`now()` })
      .where(eq(users.id, userId));
    return;
  }

  await setEmailPreference(userId, target, false, database);
}

export async function resubscribeAll(
  userId: string,
  database: DbLike = defaultDb,
): Promise<void> {
  await database
    .update(users)
    .set({ emailUnsubscribedAt: null })
    .where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// What an admin looks at
// ---------------------------------------------------------------------------

export type DeadLetter = {
  id: string;
  kind: string;
  toEmail: string;
  subject: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  userName: string | null;
  correlationId: string | null;
};

export async function deadLetters(
  limit = 50,
  database: DbLike = defaultDb,
): Promise<DeadLetter[]> {
  const rows = await database
    .select({
      id: emailDeliveries.id,
      kind: emailDeliveries.kind,
      toEmail: emailDeliveries.toEmail,
      subject: emailDeliveries.subject,
      attempts: emailDeliveries.attempts,
      lastError: emailDeliveries.lastError,
      createdAt: emailDeliveries.createdAt,
      userName: users.name,
      correlationId: emailDeliveries.correlationId,
    })
    .from(emailDeliveries)
    .innerJoin(users, eq(users.id, emailDeliveries.userId))
    .where(eq(emailDeliveries.status, 'dead'))
    .orderBy(desc(emailDeliveries.createdAt))
    .limit(limit);

  return rows as DeadLetter[];
}

/** Put a dead letter back in the queue, from zero attempts. */
export async function retryDeadLetter(
  id: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const rows = await database
    .update(emailDeliveries)
    .set({ status: 'queued', attempts: 0, nextAttemptAt: sql`now()`, expiresAt: null })
    .where(and(eq(emailDeliveries.id, id), eq(emailDeliveries.status, 'dead')))
    .returning({ id: emailDeliveries.id });

  return rows.length > 0;
}

export type EmailQueueHealth = {
  queued: number;
  dueNow: number;
  dead: number;
  oldestQueuedMinutes: number | null;
  sentLastDay: number;
};

/** What the alerts view reads. A queue that only grows is the thing to catch. */
export async function emailQueueHealth(
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<EmailQueueHealth> {
  const [row] = (await database.execute(sql`
    select
      count(*) filter (where status = 'queued')::int as queued,
      count(*) filter (where status = 'queued' and next_attempt_at <= ${now.toISOString()}::timestamptz)::int as due_now,
      count(*) filter (where status = 'dead')::int as dead,
      count(*) filter (where status = 'sent' and sent_at > ${now.toISOString()}::timestamptz - interval '1 day')::int as sent_last_day,
      extract(epoch from (${now.toISOString()}::timestamptz - min(created_at) filter (where status = 'queued'))) / 60 as oldest_minutes
    from email_deliveries
  `)) as unknown as {
    queued: number;
    due_now: number;
    dead: number;
    sent_last_day: number;
    oldest_minutes: string | null;
  }[];

  return {
    queued: Number(row?.queued ?? 0),
    dueNow: Number(row?.due_now ?? 0),
    dead: Number(row?.dead ?? 0),
    sentLastDay: Number(row?.sent_last_day ?? 0),
    oldestQueuedMinutes: row?.oldest_minutes == null ? null : Math.floor(Number(row.oldest_minutes)),
  };
}

/** Used by the flow review and by tests: what was sent to one person. */
export async function deliveriesFor(
  userId: string,
  limit = 20,
  database: DbLike = defaultDb,
): Promise<{ kind: string; status: string; subject: string; createdAt: Date }[]> {
  return database
    .select({
      kind: emailDeliveries.kind,
      status: emailDeliveries.status,
      subject: emailDeliveries.subject,
      createdAt: emailDeliveries.createdAt,
    })
    .from(emailDeliveries)
    .where(eq(emailDeliveries.userId, userId))
    .orderBy(desc(emailDeliveries.createdAt))
    .limit(limit) as unknown as Promise<
    { kind: string; status: string; subject: string; createdAt: Date }[]
  >;
}
