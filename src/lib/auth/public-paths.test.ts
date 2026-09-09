import { describe, expect, it } from 'vitest';

import { isPublicPath } from './public-paths';

/**
 * The allowlist is the difference between a legal page a regulator can read and
 * one that redirects them to a sign-in form. It is also the difference between
 * a private dashboard and an indexed one, so both directions are tested.
 */
describe('isPublicPath', () => {
  it('lets a signed-out visitor reach the pages meant for them', () => {
    for (const path of [
      '/',
      '/signin',
      '/signup',
      '/tutors',
      '/tutors/some-uuid',
      '/terms',
      '/privacy',
      '/refund-policy',
      '/tutor-agreement',
      '/child-safety',
      '/welcome',
      '/teach',
      '/pricing',
      '/robots.txt',
      '/sitemap.xml',
      '/caie-a-level-physics-tutors',
      '/o-level-tutors-in-lahore',
      '/api/health',
      '/api/auth/session',
    ]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it('keeps everything a member does behind a session', () => {
    for (const path of [
      '/dashboard',
      '/admin',
      '/admin/payouts',
      '/tutor',
      '/tutor/earnings',
      '/credits',
      '/messages',
      '/messages/thread-id',
      '/notifications',
      '/homework',
      '/progress/tutor-id',
      '/settings/curriculum',
      '/sessions/booking-id',
      '/api/bookings/id/calendar',
      '/api/files/key',
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it('does not let a prefix match half a path segment', () => {
    // `/tutor` is a private page and `/tutors` is public. A `startsWith` on the
    // shorter one would have made the tutor dashboard world-readable.
    expect(isPublicPath('/tutor')).toBe(false);
    expect(isPublicPath('/tutorial')).toBe(false);
    expect(isPublicPath('/signup-admin')).toBe(false);
  });

  it('treats a trailing slash as the same page', () => {
    expect(isPublicPath('/pricing/')).toBe(true);
    expect(isPublicPath('/dashboard/')).toBe(false);
  });

  it('lets an invited tutor reach the page that creates their account', () => {
    expect(isPublicPath('/invite/some-token')).toBe(true);
    // The admin side of the same feature stays private.
    expect(isPublicPath('/admin/invite')).toBe(false);
  });

  it('lets somebody locked out reach the pages that unlock them', () => {
    expect(isPublicPath('/forgot-password')).toBe(true);
    expect(isPublicPath('/reset-password/some-token')).toBe(true);
    expect(isPublicPath('/verify-email/some-token')).toBe(true);
    // Changing a password from inside the account still needs one.
    expect(isPublicPath('/settings/password')).toBe(false);
  });

  it('lets an unsubscribe link work without a session', () => {
    expect(isPublicPath('/unsubscribe')).toBe(true);
    expect(isPublicPath('/unsubscribe/some-token')).toBe(true);
  });
});
