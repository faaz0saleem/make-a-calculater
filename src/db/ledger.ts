/**
 * Writing to the ledger, and checking that the materialised balances still agree
 * with it (SPEC.md §12).
 *
 * Two rules govern this file:
 *
 *  1. Nothing outside it may write `ledger_entries` or touch a `_cents` balance
 *     column. Every movement arrives as a `LedgerGroup` from `src/lib/money/ledger.ts`.
 *  2. Appending is idempotent. A replayed webhook inserts nothing and adjusts no
 *     balance, because the unique index on `idempotency_key` swallows the row and
 *     only genuinely-inserted rows are applied to the materialised columns.
 */

import { eq, sql } from 'drizzle-orm';

import type { LedgerAccount, LedgerEntryDraft, LedgerGroup } from '@/lib/money/ledger';
import { assertBalanced, assertUniqueKeys } from '@/lib/money/ledger';
import { db as defaultDb, type Database } from './client';
import {
  bookings,
  ledgerEntries,
  platformAccounts,
  studentWallets,
  tutorProfiles,
} from './schema';

/** A transaction handle or the pool itself — both accept the same queries. */
export type DbLike = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export type AppendResult = {
  /** Entries that were new. Replays return an empty array. */
  inserted: LedgerEntryDraft[];
  /** Entries whose idempotency key was already present. */
  skipped: LedgerEntryDraft[];
};

/**
 * Append a group of entries and move the materialised balances by the same cents.
 *
 * Call inside a transaction that also writes whatever caused the movement (the
 * booking row, the payout row), so the ledger and the thing it describes commit
 * together or not at all.
 */
export async function appendLedger(tx: DbLike, group: LedgerGroup): Promise<AppendResult> {
  const { entries, external } = group;
  if (entries.length === 0) {
    return { inserted: [], skipped: [] };
  }

  assertUniqueKeys(entries);
  if (!external) {
    assertBalanced(entries, 'ledger group');
  }

  const rows = await tx
    .insert(ledgerEntries)
    .values(
      entries.map((entry) => ({
        account: entry.account,
        ownerId: entry.ownerId,
        deltaCents: entry.deltaCents,
        reason: entry.reason,
        idempotencyKey: entry.idempotencyKey,
        bookingId: entry.bookingId ?? null,
        payoutId: entry.payoutId ?? null,
        purchaseId: entry.purchaseId ?? null,
      })),
    )
    .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
    .returning({ idempotencyKey: ledgerEntries.idempotencyKey });

  const insertedKeys = new Set(rows.map((row) => row.idempotencyKey));
  const inserted = entries.filter((entry) => insertedKeys.has(entry.idempotencyKey));
  const skipped = entries.filter((entry) => !insertedKeys.has(entry.idempotencyKey));

  for (const entry of inserted) {
    await applyToMaterialisedBalance(tx, entry);
  }

  return { inserted, skipped };
}

/**
 * Move the one cached column that mirrors this entry's account.
 *
 * Kept as a plain switch so the mapping from ledger account to column is
 * readable in one screen. Adding an account without extending this switch is a
 * compile error.
 */
async function applyToMaterialisedBalance(tx: DbLike, entry: LedgerEntryDraft): Promise<void> {
  const delta = entry.deltaCents;

  switch (entry.account) {
    case 'student_credits': {
      const ownerId = requireOwner(entry);
      await tx
        .insert(studentWallets)
        .values({ userId: ownerId, creditsCents: delta })
        .onConflictDoUpdate({
          target: studentWallets.userId,
          set: {
            creditsCents: sql`${studentWallets.creditsCents} + ${delta}`,
            updatedAt: sql`now()`,
          },
        });

      // Money arriving with a purchase id is a top-up, not a refund.
      if (entry.purchaseId && delta > 0) {
        await tx
          .update(studentWallets)
          .set({ lifetimePurchasedCents: sql`${studentWallets.lifetimePurchasedCents} + ${delta}` })
          .where(eq(studentWallets.userId, ownerId));
      }
      return;
    }

    case 'escrow': {
      if (!entry.bookingId) {
        throw new Error(`escrow entry ${entry.idempotencyKey} must carry a booking id`);
      }
      await tx
        .update(bookings)
        .set({ escrowCents: sql`${bookings.escrowCents} + ${delta}`, updatedAt: sql`now()` })
        .where(eq(bookings.id, entry.bookingId));
      return;
    }

    case 'tutor_pending': {
      const ownerId = requireOwner(entry);
      await tx
        .update(tutorProfiles)
        .set({
          pendingCents: sql`${tutorProfiles.pendingCents} + ${delta}`,
          // Lifetime earnings only ever go up, so ignore the release back out.
          lifetimeEarnedCents: sql`${tutorProfiles.lifetimeEarnedCents} + ${Math.max(delta, 0)}`,
          updatedAt: sql`now()`,
        })
        .where(eq(tutorProfiles.userId, ownerId));
      return;
    }

    case 'tutor_available': {
      const ownerId = requireOwner(entry);
      await tx
        .update(tutorProfiles)
        .set({ availableCents: sql`${tutorProfiles.availableCents} + ${delta}`, updatedAt: sql`now()` })
        .where(eq(tutorProfiles.userId, ownerId));
      return;
    }

    case 'payout_locked': {
      const ownerId = requireOwner(entry);
      await tx
        .update(tutorProfiles)
        .set({ payoutLockedCents: sql`${tutorProfiles.payoutLockedCents} + ${delta}`, updatedAt: sql`now()` })
        .where(eq(tutorProfiles.userId, ownerId));
      return;
    }

    case 'platform_revenue': {
      await tx
        .insert(platformAccounts)
        .values({ account: 'platform_revenue', balanceCents: delta })
        .onConflictDoUpdate({
          target: platformAccounts.account,
          set: {
            balanceCents: sql`${platformAccounts.balanceCents} + ${delta}`,
            updatedAt: sql`now()`,
          },
        });
      return;
    }
  }
}

function requireOwner(entry: LedgerEntryDraft): string {
  if (!entry.ownerId) {
    throw new Error(`ledger entry ${entry.idempotencyKey} on ${entry.account} needs an owner id`);
  }
  return entry.ownerId;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type LedgerDrift = {
  account: LedgerAccount;
  scope: 'user' | 'booking' | 'platform';
  id: string | null;
  ledgerCents: number;
  materialisedCents: number;
  driftCents: number;
};

export type ReconciliationReport = {
  ok: boolean;
  checkedAt: Date;
  entryCount: number;
  drifts: LedgerDrift[];
};

type DriftRow = { id: string | null; ledger_cents: string | number; materialised_cents: string | number };

/**
 * Compare every materialised balance column against the sum of its ledger rows.
 *
 * Runs nightly. A non-empty `drifts` array means money has gone weird and the
 * job must alert loudly rather than repair anything on its own — the repair is
 * a human decision, and the ledger is the version to trust.
 */
export async function reconcileLedger(database: DbLike = defaultDb): Promise<ReconciliationReport> {
  const drifts: LedgerDrift[] = [];

  const checks: {
    account: LedgerAccount;
    scope: LedgerDrift['scope'];
    query: ReturnType<typeof sql>;
  }[] = [
    {
      account: 'student_credits',
      scope: 'user',
      query: sql`
        select coalesce(l.owner_id::text, w.user_id::text) as id,
               coalesce(l.total, 0) as ledger_cents,
               coalesce(w.credits_cents, 0) as materialised_cents
        from (
          select owner_id, sum(delta_cents) as total
          from ledger_entries where account = 'student_credits' group by owner_id
        ) l
        full outer join student_wallets w on w.user_id = l.owner_id
        where coalesce(l.total, 0) <> coalesce(w.credits_cents, 0)
      `,
    },
    {
      account: 'tutor_pending',
      scope: 'user',
      query: sql`
        select coalesce(l.owner_id::text, t.user_id::text) as id,
               coalesce(l.total, 0) as ledger_cents,
               coalesce(t.pending_cents, 0) as materialised_cents
        from (
          select owner_id, sum(delta_cents) as total
          from ledger_entries where account = 'tutor_pending' group by owner_id
        ) l
        full outer join tutor_profiles t on t.user_id = l.owner_id
        where coalesce(l.total, 0) <> coalesce(t.pending_cents, 0)
      `,
    },
    {
      account: 'tutor_available',
      scope: 'user',
      query: sql`
        select coalesce(l.owner_id::text, t.user_id::text) as id,
               coalesce(l.total, 0) as ledger_cents,
               coalesce(t.available_cents, 0) as materialised_cents
        from (
          select owner_id, sum(delta_cents) as total
          from ledger_entries where account = 'tutor_available' group by owner_id
        ) l
        full outer join tutor_profiles t on t.user_id = l.owner_id
        where coalesce(l.total, 0) <> coalesce(t.available_cents, 0)
      `,
    },
    {
      account: 'payout_locked',
      scope: 'user',
      query: sql`
        select coalesce(l.owner_id::text, t.user_id::text) as id,
               coalesce(l.total, 0) as ledger_cents,
               coalesce(t.payout_locked_cents, 0) as materialised_cents
        from (
          select owner_id, sum(delta_cents) as total
          from ledger_entries where account = 'payout_locked' group by owner_id
        ) l
        full outer join tutor_profiles t on t.user_id = l.owner_id
        where coalesce(l.total, 0) <> coalesce(t.payout_locked_cents, 0)
      `,
    },
    {
      account: 'escrow',
      scope: 'booking',
      query: sql`
        select coalesce(l.booking_id::text, b.id::text) as id,
               coalesce(l.total, 0) as ledger_cents,
               coalesce(b.escrow_cents, 0) as materialised_cents
        from (
          select booking_id, sum(delta_cents) as total
          from ledger_entries where account = 'escrow' group by booking_id
        ) l
        full outer join bookings b on b.id = l.booking_id
        where coalesce(l.total, 0) <> coalesce(b.escrow_cents, 0)
      `,
    },
    {
      /**
       * Not a balance and not in `LEDGER_ACCOUNTS` — a running total of what
       * each student has ever bought, shown on their dashboard.
       *
       * Checked here anyway, because it *is* a materialised money column moved
       * by `applyToMaterialisedBalance`, and being outside the reconciliation
       * is exactly how it came to be counted twice on every purchase without
       * anybody noticing for nine phases (MONEY_AUDIT.md, Q2). Reported under
       * `student_credits`, the account whose entries move it.
       */
      account: 'student_credits',
      scope: 'user',
      query: sql`
        select coalesce(l.owner_id::text, w.user_id::text) as id,
               coalesce(l.total, 0) as ledger_cents,
               coalesce(w.lifetime_purchased_cents, 0) as materialised_cents
        from (
          select owner_id, sum(delta_cents) as total
          from ledger_entries
          where account = 'student_credits' and purchase_id is not null and delta_cents > 0
          group by owner_id
        ) l
        full outer join student_wallets w on w.user_id = l.owner_id
        where coalesce(l.total, 0) <> coalesce(w.lifetime_purchased_cents, 0)
      `,
    },
    {
      account: 'platform_revenue',
      scope: 'platform',
      query: sql`
        select null::text as id,
               coalesce((select sum(delta_cents) from ledger_entries where account = 'platform_revenue'), 0) as ledger_cents,
               coalesce((select balance_cents from platform_accounts where account = 'platform_revenue'), 0) as materialised_cents
        where coalesce((select sum(delta_cents) from ledger_entries where account = 'platform_revenue'), 0)
           <> coalesce((select balance_cents from platform_accounts where account = 'platform_revenue'), 0)
      `,
    },
  ];

  for (const check of checks) {
    const rows = (await database.execute(check.query)) as unknown as DriftRow[];
    for (const row of rows) {
      const ledgerCents = Number(row.ledger_cents);
      const materialisedCents = Number(row.materialised_cents);
      drifts.push({
        account: check.account,
        scope: check.scope,
        id: row.id,
        ledgerCents,
        materialisedCents,
        driftCents: materialisedCents - ledgerCents,
      });
    }
  }

  const [{ count }] = (await database.execute(
    sql`select count(*)::int as count from ledger_entries`,
  )) as unknown as [{ count: number }];

  return { ok: drifts.length === 0, checkedAt: new Date(), entryCount: Number(count), drifts };
}

/** Human-readable reconciliation summary, for the cron log and the admin page. */
export function formatReconciliationReport(report: ReconciliationReport): string {
  if (report.ok) {
    return `Ledger reconciled: ${report.entryCount} entries, zero drift.`;
  }

  const lines = report.drifts.map(
    (drift) =>
      `  ${drift.account} ${drift.scope} ${drift.id ?? 'platform'}: ledger ${drift.ledgerCents}, column ${drift.materialisedCents}, drift ${drift.driftCents}`,
  );
  return `LEDGER DRIFT on ${report.drifts.length} balance(s):\n${lines.join('\n')}`;
}
