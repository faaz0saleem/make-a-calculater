import { describe, expect, it } from 'vitest';

import { describeResponseTime, medianSeconds, replyLatencies, responseMedianFor } from './response-time';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const T0 = new Date('2026-04-20T09:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const from = (senderId: string, minutes: number) => ({ senderId, createdAt: at(minutes) });

describe('replyLatencies', () => {
  const now = at(10_000);

  it('measures a student question to the tutor answer', () => {
    expect(replyLatencies([from(STUDENT, 0), from(TUTOR, 30)], TUTOR, now)).toEqual([1_800]);
  });

  it('counts a burst of student messages as one wait, from the first', () => {
    const thread = [from(STUDENT, 0), from(STUDENT, 5), from(STUDENT, 9), from(TUTOR, 30)];
    expect(replyLatencies(thread, TUTOR, now)).toEqual([1_800]);
  });

  it('counts a burst of tutor replies as one answer', () => {
    const thread = [from(STUDENT, 0), from(TUTOR, 10), from(TUTOR, 12), from(TUTOR, 15)];
    expect(replyLatencies(thread, TUTOR, now)).toEqual([600]);
  });

  it('measures each round separately', () => {
    const thread = [from(STUDENT, 0), from(TUTOR, 10), from(STUDENT, 60), from(TUTOR, 120)];
    expect(replyLatencies(thread, TUTOR, now)).toEqual([600, 3_600]);
  });

  it('ignores a tutor talking to themselves first', () => {
    const thread = [from(TUTOR, 0), from(TUTOR, 5), from(STUDENT, 10), from(TUTOR, 20)];
    expect(replyLatencies(thread, TUTOR, now)).toEqual([600]);
  });

  it('does not judge a message that is still fresh', () => {
    // Asked twenty minutes ago and not yet answered: no verdict either way.
    expect(replyLatencies([from(STUDENT, 0)], TUTOR, at(20))).toEqual([]);
  });

  it('counts silence past a day as a reply at the ceiling', () => {
    // Otherwise ignoring somebody would score better than answering slowly.
    expect(replyLatencies([from(STUDENT, 0)], TUTOR, at(60 * 30))).toEqual([86_400]);
  });

  it('reads messages in time order however they arrive', () => {
    const thread = [from(TUTOR, 30), from(STUDENT, 0)];
    expect(replyLatencies(thread, TUTOR, now)).toEqual([1_800]);
  });
});

describe('medianSeconds', () => {
  it('has nothing to say about nothing', () => {
    expect(medianSeconds([])).toBeNull();
  });

  it('takes the middle of an odd list', () => {
    expect(medianSeconds([100, 900, 300])).toBe(300);
  });

  it('averages the middle two of an even list', () => {
    expect(medianSeconds([100, 200, 300, 500])).toBe(250);
  });

  it('is not dragged by one outlier the way a mean would be', () => {
    expect(medianSeconds([60, 120, 180, 240, 86_400])).toBe(180);
  });
});

describe('responseMedianFor', () => {
  it('pools every thread the tutor is in', () => {
    const now = at(10_000);
    const threads = [
      [from(STUDENT, 0), from(TUTOR, 10)],
      [from('student-2', 0), from(TUTOR, 60)],
      [from('student-3', 0), from(TUTOR, 30)],
    ];
    expect(responseMedianFor(threads, TUTOR, now)).toBe(1_800);
  });

  it('is null for a tutor nobody has messaged', () => {
    expect(responseMedianFor([], TUTOR, at(1))).toBeNull();
  });
});

describe('describeResponseTime', () => {
  it('says nothing when there is no history', () => {
    expect(describeResponseTime(null)).toBeNull();
  });

  it('describes the wait in words a student would use', () => {
    expect(describeResponseTime(600)).toBe('Usually replies within an hour');
    expect(describeResponseTime(3 * 3_600)).toBe('Usually replies within 3 hours');
    expect(describeResponseTime(10 * 3_600)).toBe('Usually replies within a day');
    expect(describeResponseTime(48 * 3_600)).toBe('Can take more than a day to reply');
  });
});
