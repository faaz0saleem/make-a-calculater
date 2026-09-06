/**
 * The half of the outbox that renders and sends (SPEC.md §11).
 *
 * Separate from `db/email.ts` for a reason that is not tidiness: rendering an
 * email needs `react-dom/server`, and Next refuses to build a page whose module
 * graph reaches it. Enqueueing happens inside pages and server actions;
 * rendering happens here, and here is imported only by the cron route and the
 * `pnpm email` script.
 *
 * That constraint turned out to be the better design anyway. A queued row holds
 * *what happened* rather than a rendered document, so fixing a template fixes
 * the mail that is already waiting, and the row is small.
 */

import { eq, sql } from 'drizzle-orm';

import { db as defaultDb, type Database } from './client';
import { emailOrigin } from './email';
import { emailDeliveries } from './schema';
import { getEmailProvider } from '@/lib/email';
import { renderEmail, type EmailPayload } from '@/lib/email/render';
import { nextAttemptAt } from '@/lib/email/retry';
import { logEvent } from '@/lib/observability/log';

export type DrainReport = {
  attempted: number;
  sent: number;
  retrying: number;
  dead: number;
  expired: number;
};

/**
 * Send what is due.
 *
 * Rows are claimed with `for update skip locked`, so the cron and somebody
 * running `pnpm email` while debugging cannot send the same message twice. The
 * provider's own idempotency key is the second line of defence.
 */
export async function drainEmailQueue(
  now = new Date(),
  limit = 50,
  database: Database = defaultDb,
): Promise<DrainReport> {
  const report: DrainReport = { attempted: 0, sent: 0, retrying: 0, dead: 0, expired: 0 };
  const provider = getEmailProvider();
  const origin = emailOrigin();

  const due = (await database.execute(sql`
    select d.id::text, d.user_id::text, d.kind::text, d.to_email, d.payload,
           d.idempotency_key, d.attempts, d.expires_at, d.correlation_id,
           u.name as recipient_name
    from email_deliveries d
    join users u on u.id = d.user_id
    where d.status = 'queued' and d.next_attempt_at <= ${now.toISOString()}::timestamptz
    order by d.next_attempt_at
    limit ${limit}
    for update skip locked
  `)) as unknown as {
    id: string;
    user_id: string;
    kind: string;
    to_email: string;
    payload: unknown;
    idempotency_key: string;
    attempts: number;
    expires_at: string | null;
    correlation_id: string | null;
    recipient_name: string | null;
  }[];

  for (const row of due) {
    // Stale beats wrong: an hour-before reminder finally delivered after the
    // lesson tells somebody to join something that already finished.
    if (row.expires_at && new Date(row.expires_at) <= now) {
      await database
        .update(emailDeliveries)
        .set({ status: 'skipped', skipReason: 'expired', lastError: 'past its usefulness' })
        .where(eq(emailDeliveries.id, row.id));
      report.expired += 1;
      continue;
    }

    report.attempted += 1;

    let rendered;
    try {
      rendered = await renderEmail(
        { kind: row.kind, data: row.payload } as EmailPayload,
        { userId: row.user_id, name: row.recipient_name ?? 'there' },
        origin,
      );
    } catch (error) {
      // A payload the template cannot render will never render. Retrying it
      // four more times only delays somebody seeing it in dead letters.
      const message = error instanceof Error ? error.message : String(error);

      await database
        .update(emailDeliveries)
        .set({ status: 'dead', attempts: Number(row.attempts) + 1, lastError: `render: ${message}` })
        .where(eq(emailDeliveries.id, row.id));

      report.dead += 1;
      logEvent('email.dead', {
        severity: 'error',
        correlationId: row.correlation_id,
        userId: row.user_id,
        kind: row.kind,
        error: `render: ${message}`,
      });
      continue;
    }

    const result = await provider.send({
      to: row.to_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: row.idempotency_key,
      headers: unsubscribeHeaders(rendered.unsubscribeUrl),
    });

    const attempts = Number(row.attempts) + 1;

    if (result.ok) {
      // The rendered document is kept as evidence: when somebody says they were
      // never told their payout was sent, this row is the answer.
      await database
        .update(emailDeliveries)
        .set({
          status: 'sent',
          attempts,
          sentAt: now,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          provider: provider.name,
          providerMessageId: result.providerMessageId,
          lastError: null,
        })
        .where(eq(emailDeliveries.id, row.id));

      report.sent += 1;
      logEvent('email.sent', {
        correlationId: row.correlation_id,
        userId: row.user_id,
        kind: row.kind,
        provider: provider.name,
        attempts,
      });
      continue;
    }

    const retryAt = result.retryable ? nextAttemptAt(attempts, now) : null;

    if (retryAt) {
      await database
        .update(emailDeliveries)
        .set({
          attempts,
          nextAttemptAt: retryAt,
          lastError: result.error,
          provider: provider.name,
          subject: rendered.subject,
        })
        .where(eq(emailDeliveries.id, row.id));

      report.retrying += 1;
      continue;
    }

    await database
      .update(emailDeliveries)
      .set({
        status: 'dead',
        attempts,
        lastError: result.error,
        provider: provider.name,
        subject: rendered.subject,
      })
      .where(eq(emailDeliveries.id, row.id));

    report.dead += 1;
    logEvent('email.dead', {
      severity: 'error',
      correlationId: row.correlation_id,
      userId: row.user_id,
      kind: row.kind,
      provider: provider.name,
      attempts,
      error: result.error,
      retryable: result.retryable,
    });
  }

  return report;
}

/**
 * `List-Unsubscribe`, which is why a mail client draws its own unsubscribe
 * button instead of a "report spam" one.
 *
 * The header must accept POST (RFC 8058) and a page cannot, so it points at the
 * API route while the footer link in the message points at the page. Same
 * token, same effect, two audiences.
 */
function unsubscribeHeaders(unsubscribeUrl: string | null): Record<string, string> | undefined {
  if (!unsubscribeUrl) return undefined;

  return {
    'List-Unsubscribe': `<${unsubscribeUrl.replace('/unsubscribe/', '/api/unsubscribe/')}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
