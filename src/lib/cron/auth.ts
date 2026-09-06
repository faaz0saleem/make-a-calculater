/**
 * The one check every scheduled endpoint makes (SPEC.md §14).
 *
 * Vercel signs scheduled invocations with `CRON_SECRET`. Four routes had four
 * copies of this; a fifth copy is how one of them ends up without the
 * constant-time compare, or without the "no secret means shut" rule below.
 *
 * With no secret configured the endpoint stays **shut** rather than open. An
 * unconfigured deployment should fail to run its jobs — which the admin alerts
 * view shows — not expose them to anybody who guesses the path.
 */

import { safeEqual } from '@/lib/crypto';

export function cronAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

/** What an unauthorised caller sees: nothing that confirms the route exists. */
export function cronDenied(): Response {
  return new Response('Not found', { status: 404 });
}
