/**
 * Environment access, validated once at startup.
 *
 * Server-side only. Nothing here may be imported from a client component.
 * Next.js loads `.env.local` on its own; standalone scripts call `loadDotEnv()`
 * from `src/scripts/bootstrap.ts` before importing this module.
 */

import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  AUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z.string().optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  PAYOUT_ENCRYPTION_KEY: z.string().min(1, 'PAYOUT_ENCRYPTION_KEY is required'),
  PAYMENT_PROVIDER: z.string().default('mock'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment.\n${problems.join('\n')}\n\nCopy .env.example to .env.local and fill it in.`);
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: forget the parsed snapshot so a changed `process.env` is picked up. */
export function resetEnvCache(): void {
  cached = null;
}

/** Google sign-in is optional in dev; the button hides when it is not configured. */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
