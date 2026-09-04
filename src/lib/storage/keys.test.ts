import { describe, expect, it } from 'vitest';

import {
  assertValidObjectKey,
  avatarKey,
  bucketForKey,
  credentialKey,
  introVideoKey,
  isValidObjectKey,
  ObjectKeyError,
} from './keys';

const TUTOR = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';

describe('key validation', () => {
  it('accepts ordinary keys', () => {
    expect(isValidObjectKey('credentials/abc/def.pdf')).toBe(true);
    expect(isValidObjectKey('avatars/u1/a.jpg')).toBe(true);
  });

  it('rejects traversal, absolute paths and empty segments', () => {
    for (const bad of ['../secrets', 'credentials/../../etc/passwd', '/etc/passwd', 'a//b', '', 'a/../b']) {
      expect(isValidObjectKey(bad)).toBe(false);
    }
    expect(() => assertValidObjectKey('../x')).toThrow(ObjectKeyError);
  });

  it('rejects a key longer than the limit', () => {
    expect(isValidObjectKey(`a${'b'.repeat(600)}`)).toBe(false);
  });
});

describe('key builders', () => {
  it('namespaces credentials under the tutor', () => {
    expect(credentialKey(TUTOR, DOC, 'pdf')).toBe(`credentials/${TUTOR}/${DOC}.pdf`);
    expect(credentialKey(TUTOR, DOC, '.PDF')).toBe(`credentials/${TUTOR}/${DOC}.pdf`);
  });

  it('builds avatar and video keys', () => {
    expect(avatarKey(TUTOR, DOC, 'jpg')).toBe(`avatars/${TUTOR}/${DOC}.jpg`);
    expect(introVideoKey(TUTOR, DOC, 'mp4')).toBe(`videos/${TUTOR}/${DOC}.mp4`);
  });

  it('rejects a bogus extension', () => {
    expect(() => credentialKey(TUTOR, DOC, '../../sh')).toThrow(ObjectKeyError);
    expect(() => credentialKey(TUTOR, DOC, '')).toThrow(ObjectKeyError);
  });
});

describe('bucketForKey', () => {
  it('puts credentials in the private bucket and everything else in the public one', () => {
    expect(bucketForKey('credentials/a/b.pdf')).toBe('private');
    expect(bucketForKey('attachments/a/b.pdf')).toBe('private');
    expect(bucketForKey('avatars/a/b.jpg')).toBe('public');
    expect(bucketForKey('videos/a/b.mp4')).toBe('public');
  });
});

describe('publicUrlFor', () => {
  it('uses the development route with no CDN configured', async () => {
    const { publicUrlFor } = await import('./index');
    delete process.env.R2_PUBLIC_BASE_URL;
    expect(publicUrlFor('videos/t1/v1/preview.mp4')).toBe('/api/public-files/videos/t1/v1/preview.mp4');
  });

  it('uses the CDN when one is configured, without a double slash', async () => {
    const { publicUrlFor } = await import('./index');
    process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.com/';
    expect(publicUrlFor('avatars/t1/a.png')).toBe('https://cdn.example.com/avatars/t1/a.png');
    delete process.env.R2_PUBLIC_BASE_URL;
  });
});
