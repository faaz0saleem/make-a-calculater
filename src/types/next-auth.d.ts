import type { DefaultSession } from 'next-auth';
import type { UserRole } from '@/lib/auth/roles';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      roles: UserRole[];
      timezone: string;
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
  }
}
