import { describe, expect, it } from 'vitest';

import { MOCK_SIGNATURE_HEADER, MockPaymentProvider } from './mock';

const provider = new MockPaymentProvider('test-secret');

function headersFor(body: string, secret = 'test-secret'): Headers {
  const signer = new MockPaymentProvider(secret);
  return new Headers({ [MOCK_SIGNATURE_HEADER]: signer.sign(body) });
}

const paid = JSON.stringify({
  kind: 'paid',
  purchaseId: '11111111-1111-4111-8111-111111111111',
  paidCents: 2_500,
  providerRef: 'mock_11111111',
  eventId: 'evt_1',
});

describe('MockPaymentProvider', () => {
  it('sends the browser somewhere inside the app', async () => {
    const session = await provider.createCheckout({
      purchaseId: '11111111-1111-4111-8111-111111111111',
      userId: 'u',
      email: 'a@b.test',
      packId: 'standard',
      paidCents: 2_500,
      creditsCents: 2_600,
      returnUrl: '/dashboard',
    });

    expect(session.url.startsWith('/credits/checkout/')).toBe(true);
    expect(session.providerRef).toBe('mock_11111111');
  });

  it('accepts a correctly signed webhook', async () => {
    const result = await provider.parseWebhook(paid, headersFor(paid));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.kind).toBe('paid');
    expect(result.event.paidCents).toBe(2_500);
    expect(result.event.idempotencyKey).toBe('evt_1');
  });

  it('refuses a body that was tampered with after signing', async () => {
    const headers = headersFor(paid);
    const tampered = paid.replace('2500', '250000');
    const result = await provider.parseWebhook(tampered, headers);
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a signature from the wrong secret', async () => {
    const result = await provider.parseWebhook(paid, headersFor(paid, 'someone-elses-secret'));
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an unsigned body', async () => {
    const result = await provider.parseWebhook(paid, new Headers());
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an event kind it does not model', async () => {
    const body = JSON.stringify({ kind: 'disputed', purchaseId: 'p', paidCents: 1 });
    const result = await provider.parseWebhook(body, headersFor(body));
    expect(result).toEqual({ ok: false, reason: 'unknown_event' });
  });

  it('falls back to a deterministic key when the provider sends no event id', async () => {
    const body = JSON.stringify({ kind: 'paid', purchaseId: 'abc', paidCents: 100 });
    const result = await provider.parseWebhook(body, headersFor(body));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Still stable across deliveries, which is what the unique index needs.
    expect(result.event.idempotencyKey).toBe('abc:paid');
  });
});
