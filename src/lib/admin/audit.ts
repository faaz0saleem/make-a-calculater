/**
 * The admin audit log (SPEC.md §10).
 *
 * "Every money-moving admin action writes an `admin_audit` row with actor,
 * action, target, before/after, reason, IP. No exceptions."
 *
 * Verification is not money-moving on its own, but it is what lets a tutor
 * start earning, so it is logged the same way. The row is written inside the
 * same transaction as the change it describes: either both land or neither does,
 * and there is no window in which a decision exists without a record of who made
 * it.
 */

import { headers } from 'next/headers';

import { adminAudit } from '@/db/schema';
import type { DbLike } from '@/db/ledger';

export type AuditAction =
  | 'tutor.verify'
  | 'tutor.reject'
  | 'tutor.suspend'
  | 'tutor.reinstate'
  | 'credential.approve'
  | 'credential.reject'
  | 'payout.approve'
  | 'payout.reject'
  | 'payout.paid'
  | 'review.hide'
  | 'review.unhide'
  | 'dispute.settle'
  | 'dispute.refund'
  | 'pack.update'
  | 'curriculum.board.create'
  | 'curriculum.board.update'
  | 'curriculum.level.create'
  | 'curriculum.level.retire'
  | 'curriculum.level.restore'
  | 'curriculum.topic.create'
  | 'curriculum.topic.retire'
  | 'curriculum.topic.restore'
  | 'report.resolve'
  | 'contact_flag.confirm'
  | 'contact_flag.dismiss'
  /** An admin put a dead email back in the queue. */
  | 'email.retry'
  /** An admin invited a tutor directly, pre-verified. */
  | 'tutor.invite'
  | 'sanction.warn'
  | 'sanction.restrict'
  | 'sanction.review'
  | 'sanction.appeal.uphold'
  | 'sanction.appeal.lift';

export type AuditEntry = {
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
};

/** Writes one audit row. Call it inside the transaction doing the work. */
export async function writeAudit(tx: DbLike, entry: AuditEntry): Promise<void> {
  await tx.insert(adminAudit).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before === undefined ? null : (entry.before as never),
    after: entry.after === undefined ? null : (entry.after as never),
    reason: entry.reason ?? null,
    ip: entry.ip ?? null,
  });
}

/**
 * The caller's IP, for the audit row.
 *
 * Behind Vercel the first `x-forwarded-for` hop is the client. A missing header
 * is recorded as null rather than as a guess.
 */
export async function requestIp(): Promise<string | null> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  if (forwarded) {
    const [first] = forwarded.split(',');
    if (first?.trim()) return first.trim();
  }
  return headerList.get('x-real-ip')?.trim() || null;
}
