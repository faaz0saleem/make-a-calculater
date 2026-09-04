import { describe, expect, it } from 'vitest';

import { qualityLabel, shouldDropVideo, type DegradeInput } from './degrade';

const base: DegradeInput = {
  quality: 'excellent',
  live: true,
  audioOnly: false,
  alreadyDowngraded: false,
};

describe('shouldDropVideo', () => {
  it('drops video when the link turns poor mid-lesson', () => {
    expect(shouldDropVideo({ ...base, quality: 'poor' })).toBe(true);
  });

  it('leaves a good link alone', () => {
    expect(shouldDropVideo({ ...base, quality: 'good' })).toBe(false);
    expect(shouldDropVideo({ ...base, quality: 'excellent' })).toBe(false);
  });

  it('does not act on an unknown quality, which is what it is before the first report', () => {
    expect(shouldDropVideo({ ...base, quality: 'unknown' })).toBe(false);
  });

  it('does nothing before the call is up', () => {
    expect(shouldDropVideo({ ...base, quality: 'poor', live: false })).toBe(false);
  });

  it('does nothing when the camera was never on', () => {
    expect(shouldDropVideo({ ...base, quality: 'poor', audioOnly: true })).toBe(false);
  });

  it('overrules someone once, not every time they turn the camera back on', () => {
    expect(shouldDropVideo({ ...base, quality: 'poor', alreadyDowngraded: true })).toBe(false);
  });
});

describe('qualityLabel', () => {
  it('says reconnecting whatever the last quality reading was', () => {
    expect(qualityLabel('excellent', true)).toBe('Reconnecting');
    expect(qualityLabel('poor', true)).toBe('Reconnecting');
  });

  it('names the four states in words a student would use', () => {
    expect(qualityLabel('excellent', false)).toBe('Strong');
    expect(qualityLabel('good', false)).toBe('Good');
    expect(qualityLabel('poor', false)).toBe('Weak');
    expect(qualityLabel('unknown', false)).toBe('Checking');
  });
});
