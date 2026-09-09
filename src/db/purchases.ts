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
import { emailCreditsPurchased } from './email-events';
import { creditPacks, creditPurchases, studentWallets, users } from './schema';
import { purchaseGate } from '@/lib/auth/verification';
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
      firstPurchaseOnly: creditPacks.firstPurchaseOnly,
    })
    .from(creditPacks)
    .where(eq(creditPacks.active, true))
    .orderBy(creditPacks.sortOrder);

  return rows.length > 0 ? rows : [...CREDIT_PACKS];
}

/**
 * Whether this person has ever bought credits before.
 *
 * Decides whether the first-purchase pack is on the shelf. A failed attempt is
 * not a purchase — somebody whose card was declined has not had their taste.
 */
export async function hasPurchasedBefore(
  userId: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const [row] = await database
    .select({ id: creditPurchases.id })
    .from(creditPurchases)
    .where(
      and(
        eq(creditPurchases.userId, userId),
        sql`${creditPurchases.status} in ('paid', 'refunded')`,
      ),
    )
    .limit(1);

  return Boolean(row);
}

/** The packs to show this person, with the first-purchase one removed if spent. */
export async function packsForUser(
  userId: string | null,
  database: DbLike = defaultDb,
): Promise<CreditPack[]> {
  const packs = await listCreditPacks(database);
  if (!userId) return packs;

  const spent = await hasPurchasedBefore(userId, database);
  return spent ? packs.filter((pack) => !pack.firstPurchaseOnly) : packs;
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
  | {
      ok: false;
      reason: 'no_such_pack' | 'no_such_user' | 'not_a_first_purchase' | 'unverified_email';
    };

/**
 * Open a checkout.
 *
 * The row is written first, `pending`, so the id we hand the provider already
 * exists when their webhook comes back with it. Nothing is credited here.
 */
export async function startPurchase(
  input: { userId: string; packId: string; returnUrl?: string; providerId?: string | null },
  database: DbLike = defaultDb,
): Promise<StartPurchaseResult> {
  const pack = await findCreditPack(input.packId, database);
  if (!pack) return { ok: false, reason: 'no_such_pack' };

  const [user] = await database
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user) return { ok: false, reason: 'no_such_user' };

  // One of the two places a confirmed address is required (SPEC.md §1). The
  // screen checks the same rule and hides the button, so this is the second
  // line rather than the first — but it is the one that counts, because the
  // form it defends can be posted without the screen.
  if (!purchaseGate(pack.paidCents, user.emailVerified !== null).allowed) {
    return { ok: false, reason: 'unverified_email' };
  }

  // The $5 pack is a taste, not a tier: one per person, ever.
  //
  // Two guards, because they catch different things. This one refuses somebody
  // who has already bought *anything*; the partial unique index on
  // `credit_purchases` refuses a second first-purchase row even when two
  // checkouts are opened in two tabs at the same instant and both pass here.
  if (pack.firstPurchaseOnly && (await hasPurchasedBefore(input.userId, database))) {
    return { ok: false, reason: 'not_a_first_purchase' };
  }

  // The student's chosen method, or the deployment default. An unknown id
  // throws rather than quietly falling back, because `credit_purchases.provider`
  // is what support and the revenue report both read.
  const provider = getPaymentProvider(input.providerId);

  let created: { id: string } | undefined;
  try {
    [created] = await database
      .insert(creditPurchases)
      .values({
        userId: input.userId,
        packId: pack.id,
        paidCents: pack.paidCents,
        creditsCents: pack.creditsCents,
        provider: provider.name,
        status: 'pending',
        firstPurchaseOnly: pack.firstPurchaseOnly ?? false,
        // One row per checkout attempt. What stops a *redelivered webhook*
        // crediting twice is the ledger key below, not this.
        idempotencyKey: `checkout:${crypto.randomUUID()}`,
      })
      .returning({ id: creditPurchases.id });
  } catch (error) {
    if (isFirstPurchaseClash(error)) return { ok: false, reason: 'not_a_first_purchase' };
    throw error;
  }

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

/**
 * A unique-violation on the one-first-purchase-per-person index.
 *
 * Drizzle wraps the driver error, so the code is somewhere down the `cause`
 * chain rather than on the object it hands back — the same lesson the booking
 * race taught in Phase 3B.
 */
function isFirstPurchaseClash(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: string; constraint_name?: string; message?: string };
    if (
      candidate.code === '23505' &&
      (candidate.constraint_name === 'credit_purchases_first_only_key' ||
        candidate.message?.includes('credit_purchases_first_only_key'))
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
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

  const outcome = await database.transaction(async (tx) => {
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

  // The receipt goes out only on the delivery that actually credited. A webhook
  // arriving three times must not send three receipts, and the replay branch
  // above is what tells the difference.
  if (outcome.applied && outcome.reason === 'credited') {
    const [wallet] = await database
      .select({ creditsCents: studentWallets.creditsCents })
      .from(studentWallets)
      .where(eq(studentWallets.userId, purchase.userId))
      .limit(1);

    await emailCreditsPurchased(
      {
        userId: purchase.userId,
        purchaseId: purchase.id,
        paidCents: purchase.paidCents,
        addedCents: purchase.creditsCents,
        balanceCents: wallet?.creditsCents ?? purchase.creditsCents,
      },
      database,
    );
  }

  return outcome;
}

export type PurchaseRow = {
  id: string;
  packId: string;
  paidCents: number;
  creditsCents: number;
  status: string;
  /** Which provider this attempt went through. Never branched on in logic. */
  provider: string;
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
      provider: creditPurchases.provider,
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
      provider: creditPurchases.provider,
      createdAt: creditPurchases.createdAt,
      settledAt: creditPurchases.settledAt,
    })
    .from(creditPurchases)
    .where(and(eq(creditPurchases.id, purchaseId), eq(creditPurchases.userId, userId)))
    .limit(1);

  return row ?? null;
}
