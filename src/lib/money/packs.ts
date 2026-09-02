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
};

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: 'starter', name: 'Starter', paidCents: 1_000, creditsCents: 1_000, sortOrder: 1 },
  { id: 'standard', name: 'Standard', paidCents: 2_500, creditsCents: 2_600, sortOrder: 2 },
  { id: 'plus', name: 'Plus', paidCents: 5_000, creditsCents: 5_400, sortOrder: 3 },
  { id: 'pro', name: 'Pro', paidCents: 10_000, creditsCents: 11_000, sortOrder: 4 },
] as const;

export function findPack(packId: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === packId);
}

/** Bonus in basis points: Standard is 400 bps (+4%). Display only. */
export function packBonusBps(pack: CreditPack): number {
  if (pack.paidCents === 0) return 0;
  return Math.round(((pack.creditsCents - pack.paidCents) * 10_000) / pack.paidCents);
}
