/**
 * Email/password sign-up.
 *
 * A student is asked for three things and no more: an email, a password, and
 * whether they are 18 or over. Everything else arrives later, where it pays
 * them back — their class on the feed, their name on the booking form, their
 * phone at the reminder step.
 *
 * The age question is the one thing that cannot wait, because the answer
 * changes what we are allowed to do with the account. Everything else is a
 * field we can ask for at a better moment; this one is a legal obligation from
 * the first minute.
 *
 * Timezone and country are inferred from the browser and validated here. They
 * are never a question.
 *
 * Creates the user, their wallet, and — when they signed up to teach — a draft
 * tutor profile they can fill in through the Phase 1 wizard. Sign-in itself
 * goes through Auth.js; this route only creates the row.
 */

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/client';
import { studentWallets, tutorProfiles, users } from '@/db/schema';
import { requestEmailVerification } from '@/db/verification';
import { hashPassword, passwordProblem } from '@/lib/auth/password';
import type { UserRole } from '@/lib/auth/roles';
import { deriveHalfHourCents } from '@/lib/money/pricing';
import { countryFromTimeZone } from '@/lib/geo/timezone-country';
import { clientIp, rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isValidTimeZone } from '@/lib/time';

const bodySchema = z.object({
  // Optional: a student is not asked. A tutor is, because the wizard needs it
  // and signing up to teach is a more committed act than signing up to browse.
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(200),
  // The only role a visitor may ask for. `admin` is never self-assignable.
  intent: z.enum(['student', 'tutor']).default('student'),
  isAdult: z.boolean(),
  timezone: z.string().max(64).default('UTC'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});

/**
 * A display name until they give us a real one.
 *
 * The local part of the address, tidied — "ayesha.k" becomes "Ayesha K". It is
 * a placeholder and `name_confirmed_at` says so; the booking form asks properly
 * and prefills this, so accepting it is one tap and correcting it is two.
 */
function provisionalName(email: string): string {
  const local = email.split('@')[0] ?? 'there';
  const words = local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  return words.join(' ').slice(0, 120) || 'Student';
}

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

  const { email, password, intent, isAdult } = parsed.data;
  const timezone = isValidTimeZone(parsed.data.timezone) ? parsed.data.timezone : 'UTC';
  const country = parsed.data.country ?? countryFromTimeZone(timezone);

  // A tutor is paid, signs contracts and teaches minors. Under-18 is not an
  // account we can create, and saying so plainly beats creating one and
  // discovering it at verification.
  if (intent === 'tutor' && !isAdult) {
    return Response.json(
      { error: 'Tutors have to be 18 or over. You can still sign up as a student.' },
      { status: 400 },
    );
  }

  const name = parsed.data.name?.trim();
  if (intent === 'tutor' && (!name || name.length < 2)) {
    return Response.json({ error: 'Tell us your name.' }, { status: 400 });
  }

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
      .values({
        email,
        passwordHash,
        name: name || provisionalName(email),
        // A name the person actually typed is confirmed; a placeholder is not.
        nameConfirmedAt: name ? new Date() : null,
        roles,
        timezone,
        country,
        isAdult,
      })
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

    // Inside the transaction, so an account cannot exist without its
    // confirmation email having been queued. It is a nudge, not a gate:
    // nothing below waits for it and nothing above is blocked by it.
    await requestEmailVerification({ userId: created.id }, new Date(), tx);

    return created.id;
  });

  return Response.json({ ok: true, userId, roles }, { status: 201 });
}
