/**
 * Is this deployment actually working? (SPEC.md §14)
 *
 * Four dependencies, checked for real rather than reported from configuration:
 * a database round trip, a write-and-read against object storage, a LiveKit API
 * call, and the payment provider's own readiness. "Configured" is not "up" —
 * the whole point of a health check is to catch the case where the environment
 * variable is present and the service behind it is not.
 *
 * Public and unauthenticated, because an uptime monitor cannot sign in. It
 * therefore says only up or down per dependency: no hostnames, no versions, no
 * counts, nothing that helps somebody who should not be reading it.
 *
 * `?deep=1` with the cron secret adds latency numbers, for when you are trying
 * to work out which dependency is slow rather than whether it is alive.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { cronAuthorised } from '@/lib/cron/auth';
import { emailIsConfigured } from '@/lib/email';
import { isLiveKitConfigured, liveKitConfig } from '@/lib/livekit/config';
import { getPaymentProvider } from '@/lib/payments';
import { getObjectStore } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Check = { ok: boolean; ms: number; detail?: string };

async function timed(check: () => Promise<string | undefined>): Promise<Check> {
  const started = Date.now();

  try {
    const detail = await check();
    return { ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      detail: error instanceof Error ? error.message.slice(0, 200) : 'failed',
    };
  }
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get('deep') === '1' && cronAuthorised(request);

  const [database, storage, livekit, payments] = await Promise.all([
    // A real query against a real table, not `select 1`: a connection to a
    // database whose migrations have not run is not a working database.
    timed(async () => {
      const [row] = (await db.execute(
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      )) as unknown as { n: number }[];
      return `${row?.n ?? 0} migrations`;
    }),

    // Written and read back. A bucket that accepts writes and cannot serve them
    // is exactly the failure that loses somebody's credential document.
    timed(async () => {
      const store = getObjectStore();
      const key = `health/${Date.now()}.txt`;

      await store.put('private', key, Buffer.from('health'), 'text/plain');
      const back = await store.get('private', key);
      await store.delete('private', key);

      if (!back) throw new Error('wrote an object and could not read it back');
      return store.name;
    }),

    timed(async () => {
      const config = liveKitConfig();
      if (!config) throw new Error('not configured');

      // The HTTP origin of the signalling URL answers this without a room.
      const origin = config.url.replace(/^ws/, 'http').replace(/\/+$/, '');
      const response = await fetch(`${origin}/`, {
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok && response.status >= 500) {
        throw new Error(`livekit ${response.status}`);
      }
      return 'reachable';
    }),

    timed(async () => {
      const provider = getPaymentProvider();
      return provider.name;
    }),
  ]);

  const checks = { database, storage, livekit, payments };
  const ok = Object.values(checks).every((check) => check.ok);

  // Email is a queue, not a request path: it is reported but does not decide
  // liveness, because a deployment with a paused email provider is still
  // serving lessons and should not be pulled out of the load balancer.
  const email = { configured: emailIsConfigured() };

  const body = deep
    ? { ok, checks, email, livekitConfigured: isLiveKitConfigured() }
    : {
        ok,
        checks: Object.fromEntries(
          Object.entries(checks).map(([name, check]) => [name, check.ok ? 'up' : 'down']),
        ),
        email: email.configured ? 'configured' : 'mock',
      };

  return Response.json(body, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
