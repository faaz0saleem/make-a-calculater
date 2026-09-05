import { describe, expect, it } from 'vitest';

import { QUEUE_THRESHOLD, scoreContactIntent, shouldQueueForReview } from './contact-intent';

/**
 * The first block is the one that matters. Everything a tutor types while
 * actually teaching has to score zero, because the cost of a false positive
 * here is a lesson interrupted and a tutor who stops trusting the product.
 */
describe('teaching, which must never be flagged', () => {
  const lessons = [
    'question 15 on page 240',
    'x = 03',
    'Try Q7 and Q8 on page 112, then check your answer against the mark scheme.',
    'If 2x + 3 = 11 then x = 4. Do the same for question 19.',
    'Past paper 2019, paper 2, question 5 part b.',
    'Do exercises 1 2 3 4 5 6 7 8 9 10 before Thursday.',
    'The formula is v = u + at. Substitute u = 03 m/s.',
    'Chapter 4, section 4.2, problems 21 to 34.',
    'Your homework is pages 100-140, skip 118 and 119.',
    'Let me know if 4pm on the 12th works, or 16:30 on Friday.',
    'The pack is Rs 2000 for 8 sessions.',
    'ISBN 9780198392675 is the edition I teach from.',
  ];

  for (const lesson of lessons) {
    it(`scores zero: ${lesson}`, () => {
      const intent = scoreContactIntent(lesson);
      expect(intent.score).toBe(0);
      expect(intent.band).toBe('none');
      expect(shouldQueueForReview(intent)).toBe(false);
    });
  }

  it('says nothing at all in the composer for ordinary teaching', () => {
    expect(scoreContactIntent('question 15 on page 240').hint).toBeNull();
  });
});

describe('what a human should look at', () => {
  it('flags a number offered as a way to be reached', () => {
    const intent = scoreContactIntent('my number is 0300 1234567, message me on whatsapp');
    expect(intent.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
    expect(intent.band).toBe('high');
  });

  it('flags an email', () => {
    const intent = scoreContactIntent('easier over email — sadia.maths@gmail.com');
    expect(intent.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
  });

  it('flags the filter dodge, which nobody types by accident', () => {
    const intent = scoreContactIntent('sadia dot maths (at) gmail dot com');
    expect(intent.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
  });

  it('flags saying the quiet part out loud', () => {
    const intent = scoreContactIntent('we could do this directly with me, it is cheaper outside the app');
    expect(intent.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
  });

  it('flags a link straight into a messaging app', () => {
    const intent = scoreContactIntent('https://wa.me/923001234567');
    expect(intent.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
  });
});

describe('the middle, where a hint is the whole response', () => {
  it('mentions a messaging app without offering anything', () => {
    const intent = scoreContactIntent('do you use whatsapp?');
    expect(intent.band).toBe('low');
    expect(shouldQueueForReview(intent)).toBe(false);
    expect(intent.hint).not.toBeNull();
  });

  it('asks for a number without giving one', () => {
    const intent = scoreContactIntent("what's your number?");
    expect(intent.score).toBeGreaterThan(0);
    expect(shouldQueueForReview(intent)).toBe(false);
  });
});

describe('the reasons, which a reviewer reads instead of the score', () => {
  it('names each signal in plain English', () => {
    const intent = scoreContactIntent('add me on telegram @sadiateaches');
    expect(intent.signals.map((signal) => signal.id)).toContain('platform_named');
    expect(intent.signals.map((signal) => signal.id)).toContain('solicitation');
    for (const signal of intent.signals) {
      expect(signal.note.length).toBeGreaterThan(10);
      expect(signal.note).not.toMatch(/[\\^$*+?()[\]{}|]/);
    }
  });

  it('records the numbers it deliberately left alone', () => {
    const intent = scoreContactIntent(
      'my number is 0300 1234567 — also do questions 111 222 333 444 on page 12',
    );
    const ids = intent.signals.map((signal) => signal.id);
    expect(ids).toContain('phone_shaped');
    expect(ids).toContain('academic_numbers');
  });

  it('does not let one schoolwork number excuse a real one in the same message', () => {
    const intent = scoreContactIntent('page 240 question 15. whatsapp me on 0300 1234567');
    expect(intent.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
  });
});

describe('the score itself', () => {
  it('stays inside 0 and 100 however much is piled on', () => {
    const everything = scoreContactIntent(
      'add me on whatsapp 0300 1234567 or telegram @me or sadia (at) gmail dot com, ' +
        'https://wa.me/923001234567 — cheaper outside the app, pay me directly',
    );
    expect(everything.score).toBe(100);
    expect(everything.band).toBe('high');
  });

  it('is zero for an empty message', () => {
    expect(scoreContactIntent('').score).toBe(0);
  });
});
