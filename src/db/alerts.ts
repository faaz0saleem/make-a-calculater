/**
 * What is going wrong right now (SPEC.md §10, §14).
 *
 * Written for one person running this alone from a phone. Every alert answers
 * three questions in this order: is something broken, how bad, and what do I
 * do. The last one is the one dashboards usually leave out, so each alert
 * carries a runbook anchor rather than a number to interpret.
 *
 * Severity is deliberately coarse. `critical` means money is stuck or wrong and
 * somebody is affected now; `warning` means it will be critical if ignored;
 * there is no third colour, because an amber that has been amber for a month
 * teaches you to stop looking.
 */

import { sql } from 'drizzle-orm';

import { db as defaultDb } from './client';
import { emailQueueHealth } from './email';
import type { DbLike } from './ledger';
import { reconcileLedger } from './ledger';
import { DISPUTE_WINDOW_HOURS } from '@/lib/sessions/window';

export type AlertSeverity = 'critical' | 'warning';

export type Alert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  /** One line. What it means, not what the query counted. */
  detail: string;
  count: number;
  /** Where to go and do something about it. */
  href?: string;
  /** The heading in RUNBOOK.md that says what to do. */
  runbook: string;
};

/** How long a payout may sit in one state before it counts as stuck. */
export const PAYOUT_STUCK_HOURS = 72;
/** Refunds above this share of the day's settled sessions is worth a look. */
export const REFUND_SPIKE_BPS = 2_000;

export async function activeAlerts(
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const at = now.toISOString();

  // ---- the ledger -------------------------------------------------------
  // First because it is the only one that means the numbers everywhere else
  // are not to be trusted.
  const reconciliation = await reconcileLedger(database);
  if (!reconciliation.ok) {
    alerts.push({
      id: 'ledger-drift',
      severity: 'critical',
      title: 'Ledger drift',
      detail: `${reconciliation.drifts.length} balance${
        reconciliation.drifts.length === 1 ? '' : 's'
      } do not match the sum of their ledger rows. Stop payouts until this is understood.`,
      count: reconciliation.drifts.length,
      href: '/admin',
      runbook: 'ledger-drift',
    });
  }

  const [row] = (await database.execute(sql`
    select
      -- Sessions that should have settled and have not. The dispute window is
      -- 24h, and a few hours of slack keeps a late cron from crying wolf.
      (select count(*) from bookings
        where status = 'completed'
          and completed_at is not null
          and completed_at < ${at}::timestamptz - make_interval(hours => ${DISPUTE_WINDOW_HOURS + 3})
      )::int as unsettled,

      -- Money locked in a payout nobody has moved.
      (select count(*) from payouts
        where status in ('requested', 'approved', 'processing')
          and requested_at < ${at}::timestamptz - make_interval(hours => ${PAYOUT_STUCK_HOURS})
      )::int as stuck_payouts,

      (select coalesce(sum(amount_cents), 0) from payouts
        where status in ('requested', 'approved', 'processing')
          and requested_at < ${at}::timestamptz - make_interval(hours => ${PAYOUT_STUCK_HOURS})
      )::int as stuck_payout_cents,

      -- A session that happened, in the sense that its hour passed, and that
      -- neither person joined. Two of these is a coincidence; twenty is an
      -- outage in the classroom.
      (select count(*) from bookings b
        where b.start_at_utc between ${at}::timestamptz - interval '2 days' and ${at}::timestamptz
          and b.status in ('confirmed', 'in_progress')
          and not exists (
            select 1 from session_events e
            where e.booking_id = b.id and e.event = 'participant_joined'
          )
      )::int as empty_rooms,

      -- Disputes are somebody's money sitting still.
      (select count(*) from bookings where status = 'disputed')::int as disputed,

      -- A payment that started and never finished. One is a person changing
      -- their mind; a wall of them is a provider or a webhook problem.
      (select count(*) from credit_purchases
        where status = 'pending' and created_at < ${at}::timestamptz - interval '2 hours'
      )::int as stalled_purchases,

      -- Refund share of the last day's settled money.
      -- Credits going back to a student for a reason that is not a purchase:
      -- the :refund suffix is what resolveBookingOutcome writes.
      (select coalesce(sum(amount_cents), 0) from ledger_entries
        where account = 'student_credits' and amount_cents > 0
          and reason like '%:refund'
          and created_at > ${at}::timestamptz - interval '1 day'
      )::int as refunded_cents,

      (select coalesce(sum(amount_cents), 0) from ledger_entries
        where account = 'platform_revenue' and created_at > ${at}::timestamptz - interval '1 day'
      )::int as revenue_cents,

      (select count(*) from reports where status = 'open')::int as open_reports
  `)) as unknown as {
    unsettled: number;
    stuck_payouts: number;
    stuck_payout_cents: number;
    empty_rooms: number;
    disputed: number;
    stalled_purchases: number;
    refunded_cents: number;
    revenue_cents: number;
    open_reports: number;
  }[];

  const counts = row ?? {
    unsettled: 0,
    stuck_payouts: 0,
    stuck_payout_cents: 0,
    empty_rooms: 0,
    disputed: 0,
    stalled_purchases: 0,
    refunded_cents: 0,
    revenue_cents: 0,
    open_reports: 0,
  };

  if (Number(counts.unsettled) > 0) {
    alerts.push({
      id: 'settlement-behind',
      severity: 'critical',
      title: 'Settlement is behind',
      detail: `${counts.unsettled} session${
        Number(counts.unsettled) === 1 ? '' : 's'
      } finished more than ${DISPUTE_WINDOW_HOURS + 3} hours ago and the money is still in escrow. The tutor has not been paid.`,
      count: Number(counts.unsettled),
      runbook: 'settlement-did-not-run',
    });
  }

  if (Number(counts.stuck_payouts) > 0) {
    alerts.push({
      id: 'payouts-stuck',
      severity: 'critical',
      title: 'Payouts waiting',
      detail: `${counts.stuck_payouts} payout${
        Number(counts.stuck_payouts) === 1 ? '' : 's'
      } older than ${PAYOUT_STUCK_HOURS} hours, holding ${formatCents(
        Number(counts.stuck_payout_cents),
      )} of somebody else's money.`,
      count: Number(counts.stuck_payouts),
      href: '/admin/payouts',
      runbook: 'tutor-says-they-were-not-paid',
    });
  }

  if (Number(counts.disputed) > 0) {
    alerts.push({
      id: 'disputes-open',
      severity: 'warning',
      title: 'Open disputes',
      detail: `${counts.disputed} session${
        Number(counts.disputed) === 1 ? ' is' : 's are'
      } frozen pending a decision. Nothing settles until you make it.`,
      count: Number(counts.disputed),
      href: '/admin/reports',
      runbook: 'a-session-went-wrong',
    });
  }

  if (Number(counts.empty_rooms) >= 3) {
    alerts.push({
      id: 'empty-rooms',
      severity: 'critical',
      title: 'Sessions nobody joined',
      detail: `${counts.empty_rooms} sessions in the last two days where neither person appeared in the room. Check the classroom before assuming it is people.`,
      count: Number(counts.empty_rooms),
      runbook: 'a-session-failed',
    });
  }

  if (Number(counts.stalled_purchases) > 0) {
    alerts.push({
      id: 'purchases-stalled',
      severity: 'warning',
      title: 'Payments that never landed',
      detail: `${counts.stalled_purchases} credit purchase${
        Number(counts.stalled_purchases) === 1 ? '' : 's'
      } started more than two hours ago and never credited. Check the webhook before the customer does.`,
      count: Number(counts.stalled_purchases),
      runbook: 'a-payment-did-not-credit',
    });
  }

  const refunded = Number(counts.refunded_cents);
  const revenue = Number(counts.revenue_cents);
  if (refunded > 0 && revenue > 0 && (refunded * 10_000) / (refunded + revenue) > REFUND_SPIKE_BPS) {
    alerts.push({
      id: 'refund-spike',
      severity: 'warning',
      title: 'Refunds are high',
      detail: `${formatCents(refunded)} refunded in the last day against ${formatCents(
        revenue,
      )} of revenue. Worth knowing why before it is a week.`,
      count: refunded,
      href: '/admin',
      runbook: 'refunds-look-wrong',
    });
  }

  if (Number(counts.open_reports) > 0) {
    alerts.push({
      id: 'reports-open',
      severity: 'warning',
      title: 'Reports waiting',
      detail: `${counts.open_reports} report${
        Number(counts.open_reports) === 1 ? '' : 's'
      } nobody has looked at.`,
      count: Number(counts.open_reports),
      href: '/admin/reports',
      runbook: 'moderation',
    });
  }

  // ---- email ------------------------------------------------------------
  const mail = await emailQueueHealth(now, database);

  if (mail.dead > 0) {
    alerts.push({
      id: 'email-dead',
      severity: 'warning',
      title: 'Email dead letters',
      detail: `${mail.dead} message${
        mail.dead === 1 ? '' : 's'
      } gave up after every retry. A reminder that silently failed is a no-show.`,
      count: mail.dead,
      href: '/admin/alerts#dead-letters',
      runbook: 'email-is-not-sending',
    });
  }

  // Queued and old means the drain is not running at all — which looks exactly
  // like everything being fine until somebody misses a lesson.
  if (mail.oldestQueuedMinutes !== null && mail.oldestQueuedMinutes > 60) {
    alerts.push({
      id: 'email-stuck',
      severity: 'critical',
      title: 'Email queue is not draining',
      detail: `${mail.queued} queued, oldest ${mail.oldestQueuedMinutes} minutes. The cron is not running, or the provider is refusing everything.`,
      count: mail.queued,
      runbook: 'email-is-not-sending',
    });
  }

  return alerts;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
