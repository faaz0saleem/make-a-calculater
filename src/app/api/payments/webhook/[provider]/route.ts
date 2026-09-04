/**
 * One webhook endpoint per provider.
 *
 * A body must be verified with the key of the provider that signed it, so the
 * provider is named in the path rather than guessed from the payload. An id
 * that is not in the catalogue is a 404.
 */

import { handlePaymentWebhook } from '@/lib/payments/webhook';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  return handlePaymentWebhook(request, provider);
}

export async function GET() {
  return new Response('Not found', { status: 404 });
}
