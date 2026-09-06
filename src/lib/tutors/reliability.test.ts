import { describe, expect, it } from 'vitest';

import { OVERLAP_MAX_BPS } from '@/lib/ranking/overlap';
import {
  hasInstantBooking,
  RELIABILITY_MAX_PENALTY,
  reliabilityNotice,
  reliabilityPenalty,
  STRIKES_BEFORE_MANUAL_ACCEPT,
} from './reliability';

describe('the ladder', () => {
  it('costs a reliable tutor nothing', () => {
    expect(reliabilityPenalty(0)).toBe(0);
    expect(hasInstantBooking(0)).toBe(true);
    expect(reliabilityNotice(0)).toBeNull();
  });

  it('bites from the first strike', () => {
    expect(reliabilityPenalty(1)).toBeGreaterThan(0);
    // But not so hard that one bad day is career-ending.
    expect(reliabilityPenalty(1)).toBeLessThan(RELIABILITY_MAX_PENALTY);
    expect(hasInstantBooking(1)).toBe(true);
  });

  it('takes instant booking away at two', () => {
    expect(hasInstantBooking(STRIKES_BEFORE_MANUAL_ACCEPT)).toBe(false);
    expect(reliabilityNotice(2)).toContain('wait for you to accept');
  });

  it('stops getting worse after three, rather than compounding forever', () => {
    expect(reliabilityPenalty(3)).toBe(RELIABILITY_MAX_PENALTY);
    expect(reliabilityPenalty(30)).toBe(RELIABILITY_MAX_PENALTY);
  });

  /**
   * The ordering that matters: not turning up has to cost more than being in a
   * convenient timezone, or the feed is selling availability over delivery.
   */
  it('outweighs the timezone-overlap bonus', () => {
    expect(RELIABILITY_MAX_PENALTY).toBeGreaterThan(OVERLAP_MAX_BPS);
  });

  it('never removes anybody — that is an admin decision about a whole record', () => {
    expect(reliabilityNotice(9)).not.toMatch(/suspend|remove|ban/i);
  });
});
