/**
 * Credit packs (SPEC.md §2).
 *
 * These are the shipped defaults. They are also written into the `credit_packs`
 * table by the seed so admin can edit prices without a deploy; code reads the
 * table at runtime and falls back to these when the table is empty.
 */

export type CreditPack = {
  id: string;
  name: string;
  /** What the student pays the payment provider, in cents. */
  paidCents: number;
  /** What lands in the wallet, in cents. */
  creditsCents: number;
  sortOrder: number;
  /**
   * Offered only as somebody's very first purchase.
   *
   * The $5 pack is a taste, not a tier. At a fixed provider fee of 50c a $5
   * purchase is our worst-margin transaction by a distance, and it is worth
   * that exactly once — to get somebody over the line into their first lesson.
   * Repeated, it is a cheaper way to buy credits than any other pack, which is
   * not what it is for.
   *
   * Enforced by a partial unique index on `credit_purchases`, not by a check in
   * application code: two checkouts opened in two tabs would both pass a check.
   */
  firstPurchaseOnly?: boolean;
};

/**
 * The shipped packs.
 *
 * **Bonus credits are not free.** A credit is a claim on a lesson, and a lesson
 * costs us the tutor's share of it — so every dollar given away as bonus costs
 * roughly 78c of real payout, not zero. That is why the bonus now starts at $50
 * rather than at $25, and why the top tier is 5% rather than 10%: the giveaway
 * should reward the purchases whose fixed provider fee we have already
 * amortised, and nothing below that.
 */
export const CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: 'taste',
    name: 'First lesson',
    paidCents: 500,
    creditsCents: 500,
    sortOrder: 0,
    firstPurchaseOnly: true,
  },
  { id: 'starter', name: 'Starter', paidCents: 1_000, creditsCents: 1_000, sortOrder: 1 },
  { id: 'standard', name: 'Standard', paidCents: 2_500, creditsCents: 2_500, sortOrder: 2 },
  { id: 'plus', name: 'Plus', paidCents: 5_000, creditsCents: 5_150, sortOrder: 3 },
  { id: 'pro', name: 'Pro', paidCents: 10_000, creditsCents: 10_500, sortOrder: 4 },
] as const;

export function findPack(packId: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === packId);
}

/** Bonus in basis points: Plus is 300 bps (+3%). Display only. */
export function packBonusBps(pack: CreditPack): number {
  if (pack.paidCents === 0) return 0;
  return Math.round(((pack.creditsCents - pack.paidCents) * 10_000) / pack.paidCents);
}
