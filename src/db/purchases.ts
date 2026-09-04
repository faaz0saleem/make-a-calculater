/**
 * Buying credits (SPEC.md §2, §14).
 *
 * Two things make this safe under a provider that delivers the same webhook
 * three times:
 *
 *  1. The credit lands as a **ledger entry** whose idempotency key is derived
 *     from the purchase, and `ledger_entries.idempotency_key` is unique. The
 *     second and third deliveries insert nothing and move no balance —
 *     `appendLedger` only applies rows it actually inserted.
 *  2. The status flip is conditional on the row still being `pending`, so a
 *     redelivery cannot re-stamp `settled_at` either.
 *
 * Neither guard is a check-then-act in application code, which is the point:
 * two deliveries arriving at the same moment race, and a unique index does not.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { appendLedger } from './ledger';
import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { creditPacks, creditPurchases, studentWallets, users } from './schema';
import { creditPurchaseEntries } from '@/lib/money/ledger';
import { CREDIT_PACKS, type CreditPack } from '@/lib/money/packs';
import { getPaymentProvider, type PaymentEvent } from '@/lib/payments';

/**
 * The packs on sale, from the table an admin edits.
 *
 * Falls back to the shipped defaults only when the table is empty — a fresh
 * database should still be able to sell something.
 */
export async function listCreditPacks(database: DbLike = defaultDb): Promise<CreditPack[]> {
  const rows = await database
    .select({
      id: creditPacks.id,
      name: creditPacks.name,
      paidCents: creditPacks.paidCents,
      creditsCents: creditPacks.creditsCents,
      sortOrder: creditPacks.sortOrder,
    })
    .from(creditPacks)
    .where(eq(creditPacks.active, true))
    .orderBy(creditPacks.sortOrder);

  return rows.length > 0 ? rows : [...CREDIT_PACKS];
}

export async function findCreditPack(
  packId: string,
  database: DbLike = defaultDb,
): Promise<CreditPack | null> {
  const packs = await listCreditPacks(database);
  return packs.find((pack) => pack.id === packId) ?? null;
}

export type StartPurchaseResult =
  | { ok: true; purchaseId: string; checkoutUrl: string }
  | { ok: false; reason: 'no_such_pack' | 'no_such_user' };

/**
 * Open a checkout.
 *
 * The row is written first, `pending`, so the id we hand the provider already
 * exists when their webhook comes back with it. Nothing is credited here.
 */
export async function startPurchase(
  input: { userId: string; packId: string; returnUrl?: string },
  database: DbLike = defaultDb,
): Promise<StartPurchaseResult> {
  const pack = await findCreditPack(input.packId, database);
  if (!pack) return { ok: false, reason: 'no_such_pack' };

  const [user] = await database
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user) return { ok: false, reason: 'no_such_user' };

  const provider = getPaymentProvider();

  const [created] = await database
    .insert(creditPurchases)
    .values({
      userId: input.userId,
      packId: pack.id,
      paidCents: pack.paidCents,
      creditsCents: pack.creditsCents,
      provider: provider.name,
      status: 'pending',
      // One row per checkout attempt. What stops a *redelivered webhook*
      // crediting twice is the ledger key below, not this.
      idempotencyKey: `checkout:${crypto.randomUUID()}`,
    })
    .returning({ id: creditPurchases.id });

  const purchaseId = created!.id;

  const session = await provider.createCheckout({
    purchaseId,
    userId: input.userId,
    email: user.email,
    packId: pack.id,
    paidCents: pack.paidCents,
    creditsCents: pack.creditsCents,
    returnUrl: input.returnUrl ?? '/dashboard',
  });

  await database
    .update(creditPurchases)
    .set({ providerRef: session.providerRef })
    .where(eq(creditPurchases.id, purchaseId));

  return { ok: true, purchaseId, checkoutUrl: session.url };
}

export type ApplyEventResult = {
  /** False when this delivery changed nothing — a replay, or an unknown purchase. */
  applied: boolean;
  reason: 'credited' | 'replay' | 'unknown_purchase' | 'amount_mismatch' | 'failed' | 'refunded';
  creditsCents?: number;
};

/**
 * Apply a verified provider event.
 *
 * Safe to call with the same event any number of times. The interesting case is
 * three simultaneous deliveries: they all read `pending`, all try to insert the
 * ledger row, and exactly one wins the unique index. The two that lose insert
 * nothing, move no balance, and report a replay.
 */
export async function applyPaymentEvent(
  event: PaymentEvent,
  now = new Date(),
  database: DbLike = defaultDb,
): Promise<ApplyEventResult> {
  const [purchase] = await database
    .select({
      id: creditPurchases.id,
      userId: creditPurchases.userId,
      paidCents: creditPurchases.paidCents,
      creditsCents: creditPurchases.creditsCents,
      status: creditPurchases.status,
    })
    .from(creditPurchases)
    .where(eq(creditPurchases.id, event.purchaseId))
    .limit(1);

  if (!purchase) return { applied: false, reason: 'unknown_purchase' };

  if (event.kind === 'failed') {
    await database
      .update(creditPurchases)
      .set({ status: 'failed', providerRef: event.providerRef })
      .where(and(eq(creditPurchases.id, purchase.id), eq(creditPurchases.status, 'pending')));
    return { applied: purchase.status === 'pending', reason: 'failed' };
  }

  if (event.kind === 'refunded') {
    await database
      .update(creditPurchases)
      .set({ status: 'refunded', providerRef: event.providerRef })
      .where(and(eq(creditPurchases.id, purchase.id), eq(creditPurchases.status, 'paid')));
    return { applied: purchase.status === 'paid', reason: 'refunded' };
  }

  // A provider telling us a different number than the one we asked for is not
  // something to paper over.
  if (event.paidCents !== purchase.paidCents) {
    console.error(
      `payment event for purchase ${purchase.id} says ${event.paidCents} cents, we asked for ${purchase.paidCents}`,
    );
    return { applied: false, reason: 'amount_mismatch' };
  }

  return database.transaction(async (tx) => {
    const result = await appendLedger(
      tx,
      creditPurchaseEntries({
        purchaseId: purchase.id,
        userId: purchase.userId,
        creditsCents: purchase.creditsCents,
      }),
    );

    // Nothing inserted means this purchase has already been credited.
    if (result.inserted.length === 0) {
      return { applied: false, reason: 'replay' as const };
    }

    await tx
      .update(creditPurchases)
      .set({ status: 'paid', settledAt: now, providerRef: event.providerRef })
      .where(and(eq(creditPurchases.id, purchase.id), eq(creditPurchases.status, 'pending')));

    await tx
      .update(studentWallets)
      .set({ lifetimePurchasedCents: sql`${studentWallets.lifetimePurchasedCents} + ${purchase.creditsCents}` })
      .where(eq(studentWallets.userId, purchase.userId));

    return { applied: true, reason: 'credited' as const, creditsCents: purchase.creditsCents };
  });
}

export type PurchaseRow = {
  id: string;
  packId: string;
  paidCents: number;
  creditsCents: number;
  status: string;
  createdAt: Date;
  settledAt: Date | null;
};

export async function purchaseHistoryFor(
  userId: string,
  limit = 10,
  database: DbLike = defaultDb,
): Promise<PurchaseRow[]> {
  return database
    .select({
      id: creditPurchases.id,
      packId: creditPurchases.packId,
      paidCents: creditPurchases.paidCents,
      creditsCents: creditPurchases.creditsCents,
      status: creditPurchases.status,
      createdAt: creditPurchases.createdAt,
      settledAt: creditPurchases.settledAt,
    })
    .from(creditPurchases)
    .where(eq(creditPurchases.userId, userId))
    .orderBy(desc(creditPurchases.createdAt))
    .limit(limit);
}

/** One purchase, for the checkout page. Scoped to its owner. */
export async function loadPurchaseFor(
  purchaseId: string,
  userId: string,
  database: DbLike = defaultDb,
): Promise<PurchaseRow | null> {
  const [row] = await database
    .select({
      id: creditPurchases.id,
      packId: creditPurchases.packId,
      paidCents: creditPurchases.paidCents,
      creditsCents: creditPurchases.creditsCents,
      status: creditPurchases.status,
      createdAt: creditPurchases.createdAt,
      settledAt: creditPurchases.settledAt,
    })
    .from(creditPurchases)
    .where(and(eq(creditPurchases.id, purchaseId), eq(creditPurchases.userId, userId)))
    .limit(1);

  return row ?? null;
}
