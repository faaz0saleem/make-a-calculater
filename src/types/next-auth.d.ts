import type { DefaultSession } from 'next-auth';
import type { UserRole } from '@/lib/auth/roles';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      roles: UserRole[];
      timezone: string;
      /**
       * When this *session* began, in epoch milliseconds.
       *
       * Not the JWT's `iat`, which Auth.js refreshes on every request. Carried
       * so `currentUser()` can refuse a session older than the account's
       * `sessions_valid_from` — which is how "sign out everywhere" works when
       * sessions are JWTs and there is no server-side store to delete from.
       */
      signedInAtMs: number;
    } & DefaultSession['user'];
  }

  interface User {
    roles?: UserRole[];
    timezone?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    roles?: UserRole[];
    timezone?: string;
    /** Epoch milliseconds, written at sign-in and on an explicit update. */
    signedInAtMs?: number;
  }
}
