/**
 * The default provider's webhook (SPEC.md §2, §13.4).
 *
 * The provider tells us a purchase was paid. It will tell us more than once —
 * every provider retries, and some retry a delivery that already succeeded — so
 * the only thing that matters here is that the second and third deliveries
 * change nothing. Two guards, neither of them a check-then-act: the signature,
 * verified against the raw body before anything is parsed, and
 * `ledger_entries.idempotency_key`, unique and derived from the purchase.
 *
 * Providers added after the first get their own endpoint at
 * `./[provider]/route.ts`. This one stays for the deployment default so an
 * already-configured webhook URL keeps working.
 */

import { handlePaymentWebhook } from '@/lib/payments/webhook';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handlePaymentWebhook(request);
}

export async function GET() {
  return new Response('Not found', { status: 404 });
}
