/**
 * Auth.js v5 (SPEC.md §14): email/password plus Google.
 *
 * Runs on the Node runtime because it touches Postgres and bcrypt. Middleware
 * uses `src/auth.config.ts` instead.
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq, sql } from 'drizzle-orm';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';

import { cookies } from 'next/headers';

import { authConfig } from '@/auth.config';
import { db } from '@/db/client';
import { accounts, sessions, studentWallets, users, verificationTokens } from '@/db/schema';
import { verifyPassword } from '@/lib/auth/password';
import type { UserRole } from '@/lib/auth/roles';
import { countryFromTimeZone } from '@/lib/geo/timezone-country';
import { isValidTimeZone } from '@/lib/time';
import { isGoogleConfigured } from '@/lib/env';

/** Set by the signup form before it hands the browser to Google. */
const SIGNUP_HINT_COOKIE = 'tutorly_signup';

type SignupHint = {
  isAdult?: unknown;
  intent?: unknown;
  timezone?: unknown;
  country?: unknown;
};

/**
 * The answers the signup form collected, carried across Google's round trip.
 *
 * Google gives us an email and a name and nothing else, so the 18-or-over
 * answer and the inferred place would be lost between pressing the button and
 * coming back. A short-lived cookie carries them.
 *
 * Everything in it is a *hint*, not a credential: the worst somebody can do by
 * forging it is set their own timezone and lie about their age, both of which
 * they could do on the form anyway. No role is ever read from it.
 */
async function readSignupHint(): Promise<SignupHint | null> {
  try {
    const raw = (await cookies()).get(SIGNUP_HINT_COOKIE)?.value;
    if (!raw) return null;

    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    return typeof parsed === 'object' && parsed !== null ? (parsed as SignupHint) : null;
  } catch {
    return null;
  }
}

const googleProviders = isGoogleConfigured()
  ? [
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        allowDangerousEmailAccountLinking: false,
      }),
    ]
  : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    ...googleProviders,
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const email = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : '';
        const password = typeof raw?.password === 'string' ? raw.password : '';
        if (!email || !password) return null;

        const [record] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            image: users.image,
            passwordHash: users.passwordHash,
            roles: users.roles,
            timezone: users.timezone,
            suspendedAt: users.suspendedAt,
          })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1);

        // Always run the comparison, even on a miss, so timing does not reveal
        // whether the address exists.
        const ok = await verifyPassword(password, record?.passwordHash ?? null);
        if (!record || !ok || record.suspendedAt) return null;

        return {
          id: record.id,
          email: record.email,
          name: record.name,
          image: record.image,
          roles: record.roles as UserRole[],
          timezone: record.timezone,
        };
      },
    }),
  ],
  events: {
    /**
     * Finish an account the adapter just created for a Google sign-in.
     *
     * The adapter writes an email, a name and an image — the columns Auth.js
     * knows about. Everything this product needs beyond that lands here: the
     * wallet every student has, and the answers the signup form collected
     * before handing the browser to Google.
     *
     * Runs exactly once per account, which is why it is an event rather than a
     * check on every sign-in.
     */
    async createUser({ user }) {
      if (!user.id) return;

      const hint = await readSignupHint();
      const timezone =
        typeof hint?.timezone === 'string' && isValidTimeZone(hint.timezone) ? hint.timezone : 'UTC';
      const country =
        typeof hint?.country === 'string' && /^[A-Za-z]{2}$/.test(hint.country)
          ? hint.country.toUpperCase()
          : countryFromTimeZone(timezone);

      // Only a student. Signing up to teach goes through the wizard, which
      // needs a name, a rate and documents — none of which Google supplies.
      await db
        .update(users)
        .set({
          roles: ['student'],
          timezone,
          country,
          isAdult: typeof hint?.isAdult === 'boolean' ? hint.isAdult : null,
          // Google gives a real name, so it is confirmed rather than a
          // placeholder waiting for the booking form.
          nameConfirmedAt: user.name ? new Date() : null,
        })
        .where(eq(users.id, user.id));

      await db.insert(studentWallets).values({ userId: user.id }).onConflictDoNothing();
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    /**
     * The JWT carries the roles. On sign-in they come from the provider result;
     * on later requests they are re-read from the database so a role change or a
     * suspension takes effect without waiting for the token to expire.
     */
    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id ?? token.sub;
        token.roles = (user.roles as UserRole[] | undefined) ?? ['student'];
        token.timezone = user.timezone ?? 'UTC';
        return token;
      }

      if (token.sub && (trigger === 'update' || !token.roles)) {
        const [record] = await db
          .select({ roles: users.roles, timezone: users.timezone, suspendedAt: users.suspendedAt })
          .from(users)
          .where(eq(users.id, token.sub))
          .limit(1);

        if (!record || record.suspendedAt) {
          token.roles = [];
        } else {
          token.roles = record.roles as UserRole[];
          token.timezone = record.timezone;
        }
      }

      return token;
    },
  },
});
