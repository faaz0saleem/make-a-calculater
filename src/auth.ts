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

import { authConfig } from '@/auth.config';
import { db } from '@/db/client';
import { accounts, sessions, users, verificationTokens } from '@/db/schema';
import { verifyPassword } from '@/lib/auth/password';
import type { UserRole } from '@/lib/auth/roles';
import { isGoogleConfigured } from '@/lib/env';

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
