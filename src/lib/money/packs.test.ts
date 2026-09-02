import { describe, expect, it } from 'vitest';
import { CREDIT_PACKS, findPack, packBonusBps } from './packs';

describe('credit packs', () => {
  it('matches the table in SPEC.md §2', () => {
    expect(CREDIT_PACKS.map((pack) => [pack.paidCents, pack.creditsCents])).toEqual([
      [1_000, 1_000],
      [2_500, 2_600],
      [5_000, 5_400],
      [10_000, 11_000],
    ]);
  });

  it('advertises the right bonus percentages', () => {
    expect(CREDIT_PACKS.map(packBonusBps)).toEqual([0, 400, 800, 1_000]);
  });

  it('is all integer cents', () => {
    for (const pack of CREDIT_PACKS) {
      expect(Number.isInteger(pack.paidCents)).toBe(true);
      expect(Number.isInteger(pack.creditsCents)).toBe(true);
    }
  });

  it('looks packs up by id', () => {
    expect(findPack('pro')?.creditsCents).toBe(11_000);
    expect(findPack('nope')).toBeUndefined();
  });
});
