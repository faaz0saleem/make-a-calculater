import { describe, expect, it } from 'vitest';

import { REDACTED, maskContactInfo } from './masking';

const masked = (body: string) => maskContactInfo(body).masked;

describe('maskContactInfo', () => {
  it('leaves an ordinary message alone', () => {
    const body = 'Hi! Could we go over quadratic equations on Thursday? I struggled with question 4.';
    const result = maskContactInfo(body);
    expect(result.masked).toBe(body);
    expect(result.redactions).toBe(0);
  });

  it('hides an email address', () => {
    const result = maskContactInfo('email me at hassan.raza@gmail.com and we can sort it out');
    expect(result.masked).toBe(`email me at ${REDACTED} and we can sort it out`);
    expect(result.kinds).toContain('email');
  });

  it('hides an email written to dodge the filter', () => {
    expect(masked('reach me: hassan (at) gmail (dot) com')).toContain(REDACTED);
    expect(masked('reach me: hassan at gmail dot com')).toContain(REDACTED);
  });

  it('hides phone numbers however they are punctuated', () => {
    for (const number of [
      '+92 300 1234567',
      '03001234567',
      '(0300) 123-4567',
      '00923001234567',
      '971 50 123 4567',
    ]) {
      expect(masked(`call me on ${number}`), number).toBe(`call me on ${REDACTED}`);
    }
  });

  it('does not mistake ordinary numbers for a phone number', () => {
    expect(masked('lets do 4 sessions before the 15 May exam')).toBe(
      'lets do 4 sessions before the 15 May exam',
    );
    expect(masked('question 12 and 13 in chapter 4')).toBe('question 12 and 13 in chapter 4');
    expect(masked('the answer is 3.14159')).toBe('the answer is 3.14159');
  });

  it('hides messaging-app handles', () => {
    expect(masked('whatsapp 03001234567')).toBe(REDACTED);
    expect(masked('my telegram: @hassanteaches')).toBe(`my ${REDACTED}`);
    expect(masked('add me on instagram hassan.teaches')).toContain(REDACTED);
    expect(masked('skype: live:hassan.raza')).toBe(REDACTED);
  });

  it('hides a bare handle', () => {
    expect(masked('find me @hassanteaches')).toBe(`find me ${REDACTED}`);
  });

  it('hides messaging-app links but leaves teaching links alone', () => {
    expect(masked('https://wa.me/923001234567')).toBe(REDACTED);
    expect(masked('join https://t.me/hassan')).toBe(`join ${REDACTED}`);

    const paper = 'the past paper is at https://en.wikipedia.org/wiki/Quadratic_formula';
    expect(masked(paper)).toBe(paper);
  });

  it('counts every separate redaction', () => {
    const result = maskContactInfo('email hassan@gmail.com or call +92 300 1234567');
    expect(result.redactions).toBe(2);
    expect(result.kinds.sort()).toEqual(['email', 'phone']);
  });

  it('does not redact its own placeholder on a later pass', () => {
    const result = maskContactInfo('hassan@gmail.com');
    expect(result.masked).toBe(REDACTED);
    expect(result.redactions).toBe(1);
  });

  it('is honest about what it cannot catch', () => {
    // Documented, not fixed: a number in words gets through, which is why the
    // raw text is kept for moderation.
    const spelled = 'my number is oh three double oh, one two three four five six seven';
    expect(maskContactInfo(spelled).redactions).toBe(0);
  });
});
