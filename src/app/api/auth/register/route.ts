/**
 * Email/password sign-up.
 *
 * Creates the user, their wallet, and — when they signed up to teach — a draft
 * tutor profile they can fill in through the Phase 1 wizard. Sign-in itself
 * goes through Auth.js; this route only creates the row.
 */

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/client';
import { studentWallets, tutorProfiles, users } from '@/db/schema';
import { hashPassword, passwordProblem } from '@/lib/auth/password';
import type { UserRole } from '@/lib/auth/roles';
import { deriveHalfHourCents } from '@/lib/money/pricing';
import { clientIp, rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isValidTimeZone } from '@/lib/time';

const bodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(200),
  // The only role a visitor may ask for. `admin` is never self-assignable.
  intent: z.enum(['student', 'tutor']).default('student'),
  timezone: z.string().max(64).default('UTC'),
});

export async function POST(request: Request) {
  const limit = rateLimit(`register:${clientIp(request.headers)}`, RATE_LIMITS.auth);
  if (!limit.ok) {
    return Response.json(
      { error: 'Too many attempts. Try again in a minute.' },
      { status: 429, headers: { 'retry-after': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Check the form and try again.' }, { status: 400 });
  }

  const { name, email, password, intent } = parsed.data;
  const timezone = isValidTimeZone(parsed.data.timezone) ? parsed.data.timezone : 'UTC';

  const problem = passwordProblem(password);
  if (problem) {
    return Response.json({ error: problem }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing) {
    // Do not confirm which addresses are registered.
    return Response.json({ error: 'That email cannot be used. Try signing in instead.' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  // A tutor can take lessons too, so they always get the student role as well.
  const roles: UserRole[] = intent === 'tutor' ? ['student', 'tutor'] : ['student'];

  const userId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ email, passwordHash, name, roles, timezone })
      .returning({ id: users.id });

    if (!created) throw new Error('failed to create user');

    await tx.insert(studentWallets).values({ userId: created.id });

    if (intent === 'tutor') {
      await tx.insert(tutorProfiles).values({
        userId: created.id,
        status: 'draft',
        hourlyCents: 2_500,
        halfHourCents: deriveHalfHourCents(2_500),
      });
    }

    return created.id;
  });

  return Response.json({ ok: true, userId, roles }, { status: 201 });
}
