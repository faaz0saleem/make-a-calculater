/**
 * The payment webhook (SPEC.md §2, §13.4).
 *
 * The provider tells us a purchase was paid. It will tell us more than once —
 * every provider retries, and some retry a delivery that already succeeded — so
 * the only thing that matters here is that the second and third deliveries
 * change nothing.
 *
 * Two guards, neither of them a check-then-act:
 *
 *  - the signature, verified against the raw body before anything is parsed
 *  - `ledger_entries.idempotency_key`, unique, derived from the purchase
 *
 * The route reports which happened, so a redelivery is visibly a no-op rather
 * than silently indistinguishable from the first.
 */

import { applyPaymentEvent } from '@/db/purchases';
import { getPaymentProvider } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const provider = getPaymentProvider();

  // The raw bytes: every provider signs what was sent, not what we re-encode.
  const body = await request.text();
  const parsed = await provider.parseWebhook(body, request.headers);

  if (!parsed.ok) {
    // A bad signature is a 401 and nothing else — no hint about whether the
    // purchase in the body exists.
    const status = parsed.reason === 'bad_signature' ? 401 : 400;
    return Response.json({ ok: false, reason: parsed.reason }, { status });
  }

  try {
    const result = await applyPaymentEvent(parsed.event);

    // 200 either way: a provider that gets a 500 for a duplicate will keep
    // sending it, which is the opposite of what we want.
    return Response.json({ ok: true, applied: result.applied, reason: result.reason });
  } catch (error) {
    console.error('payment webhook failed', error);
    return Response.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

export async function GET() {
  return new Response('Not found', { status: 404 });
}
