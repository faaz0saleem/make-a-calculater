import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_KINDS, isEmailKind, isOptionalEmail, OPTIONAL_EMAIL_KINDS } from './kinds';
import { MockEmailProvider } from './mock';
import { ResendEmailProvider } from './resend';
import { EMAIL_BACKOFF_SECONDS, isDead, MAX_EMAIL_ATTEMPTS, nextAttemptAt } from './retry';
import { unsubscribeToken, verifyUnsubscribeToken } from './unsubscribe';
import { resetEnvCache } from '../env';

const NOW = new Date('2026-09-06T10:00:00Z');

describe('email kinds', () => {
  it('splits optional from operational, and never lets money be optional', () => {
    // The list somebody may switch off is a promise. These four are the ones a
    // person would be worst served by missing, so they are pinned here rather
    // than only in a comment.
    for (const kind of [
      'payout_status',
      'booking_cancelled',
      'credits_purchased',
      'verification_decision',
    ] as const) {
      expect(isOptionalEmail(kind), kind).toBe(false);
    }

    expect(isOptionalEmail('reminder_1h')).toBe(true);
    expect(OPTIONAL_EMAIL_KINDS.size).toBeLessThan(EMAIL_KINDS.length);
  });

  it('recognises its own kinds and nothing else', () => {
    expect(isEmailKind('reminder_1h')).toBe(true);
    expect(isEmailKind('new_message')).toBe(false);
    expect(isEmailKind('')).toBe(false);
  });
});

describe('retry schedule', () => {
  it('backs off, then gives up', () => {
    const noJitter = () => 0;

    expect(nextAttemptAt(1, NOW, noJitter)).toEqual(
      new Date(NOW.getTime() + EMAIL_BACKOFF_SECONDS[0]! * 1_000),
    );
    expect(nextAttemptAt(2, NOW, noJitter)).toEqual(
      new Date(NOW.getTime() + EMAIL_BACKOFF_SECONDS[1]! * 1_000),
    );
    // Past the end of the table it holds at the longest gap rather than growing.
    expect(nextAttemptAt(4, NOW, noJitter)).toEqual(
      new Date(NOW.getTime() + EMAIL_BACKOFF_SECONDS[3]! * 1_000),
    );
    expect(nextAttemptAt(MAX_EMAIL_ATTEMPTS, NOW, noJitter)).toBeNull();
  });

  it('spreads retries so an outage does not come back as a stampede', () => {
    const early = nextAttemptAt(1, NOW, () => 0)!;
    const late = nextAttemptAt(1, NOW, () => 1)!;

    expect(late.getTime()).toBeGreaterThan(early.getTime());
    // Bounded: jitter is a smear, not a second backoff.
    expect(late.getTime() - early.getTime()).toBeLessThanOrEqual(
      EMAIL_BACKOFF_SECONDS[0]! * 0.2 * 1_000,
    );
  });

  it('knows when a row belongs in dead letters', () => {
    expect(isDead(MAX_EMAIL_ATTEMPTS - 1)).toBe(false);
    expect(isDead(MAX_EMAIL_ATTEMPTS)).toBe(true);
  });
});

describe('the mock transport', () => {
  it('sends once for one idempotency key', async () => {
    const provider = new MockEmailProvider();
    const email = {
      to: 'a@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
      idempotencyKey: 'booking:1:confirmed',
    };

    const first = await provider.send(email);
    const second = await provider.send(email);

    expect(first).toEqual(second);
    expect(provider.sent()).toHaveLength(1);
  });

  it('can be told to fail, retryably or not', async () => {
    const provider = new MockEmailProvider();
    provider.failWith = { retryable: false, error: 'bad address' };

    const result = await provider.send({
      to: 'nope',
      subject: 's',
      html: '',
      text: '',
      idempotencyKey: 'k',
    });

    expect(result).toEqual({ ok: false, retryable: false, error: 'bad address' });
    expect(provider.sent()).toHaveLength(0);
  });
});

describe('Resend failure classification', () => {
  const send = async (status: number, body = '{}') => {
    const provider = new ResendEmailProvider({
      apiKey: 'test',
      from: 'Tutorly <hello@example.com>',
      fetchImpl: (async () =>
        new Response(body, { status, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });

    return provider.send({
      to: 'a@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
      idempotencyKey: 'k',
    });
  };

  it('treats a rejected address as final and an outage as temporary', async () => {
    // The distinction is the whole reason the result type carries `retryable`:
    // retrying a malformed address five times only delays somebody noticing.
    expect(await send(422, '{"message":"invalid to"}')).toMatchObject({ ok: false, retryable: false });
    expect(await send(403)).toMatchObject({ ok: false, retryable: false });
    expect(await send(429)).toMatchObject({ ok: false, retryable: true });
    expect(await send(503)).toMatchObject({ ok: false, retryable: true });
  });

  it('returns the provider id on success', async () => {
    expect(await send(200, '{"id":"re_123"}')).toEqual({ ok: true, providerMessageId: 're_123' });
  });

  it('treats a transport failure as retryable', async () => {
    const provider = new ResendEmailProvider({
      apiKey: 'test',
      from: 'Tutorly <hello@example.com>',
      fetchImpl: (async () => {
        throw new Error('ECONNRESET');
      }) as typeof fetch,
    });

    const result = await provider.send({
      to: 'a@example.com',
      subject: 's',
      html: '',
      text: '',
      idempotencyKey: 'k',
    });

    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(result).toHaveProperty('error', expect.stringContaining('ECONNRESET'));
  });
});

describe('unsubscribe tokens', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-that-is-long-enough');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('PAYOUT_ENCRYPTION_KEY', Buffer.alloc(32).toString('base64'));
    resetEnvCache();
  });

  it('round-trips a user and a kind', () => {
    const token = unsubscribeToken('11111111-2222-3333-4444-555555555555', 'reminder_1h');

    expect(verifyUnsubscribeToken(token)).toEqual({
      userId: '11111111-2222-3333-4444-555555555555',
      target: 'reminder_1h',
    });
  });

  it('round-trips the global switch', () => {
    const token = unsubscribeToken('user-1', 'all');
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: 'user-1', target: 'all' });
  });

  it('refuses a token whose payload was edited', () => {
    // The attack this stops is somebody swapping the user id in a link they
    // received and unsubscribing a stranger.
    const token = unsubscribeToken('user-1', 'reminder_1h');
    const [, signature] = token.split('.');
    const forged = `${Buffer.from('user-2:reminder_1h').toString('base64url')}.${signature}`;

    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it('refuses rubbish rather than throwing', () => {
    for (const bad of ['', '.', 'nope', 'a.b', `${Buffer.from('u:all').toString('base64url')}.`]) {
      expect(verifyUnsubscribeToken(bad)).toBeNull();
    }
  });

  it('will not carry a kind that does not exist', () => {
    const token = unsubscribeToken('user-1', 'new_message' as never);
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });
});
