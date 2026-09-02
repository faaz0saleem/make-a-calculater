import Link from 'next/link';

import { auth, signOut } from '@/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { defaultLandingPath } from '@/lib/auth/roles';

export async function SiteHeader() {
  const session = await auth();
  const roles = session?.user?.roles ?? [];

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Tutorly
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          {session?.user ? (
            <>
              <span className="hidden text-muted-foreground sm:inline">{session.user.email}</span>
              {roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {role}
                </Badge>
              ))}
              <Link href={defaultLandingPath(roles)}>
                <Button size="sm" variant="outline">
                  Dashboard
                </Button>
              </Link>
              <form
                action={async () => {
                  'use server';
                  await signOut({ redirectTo: '/' });
                }}
              >
                <Button size="sm" variant="ghost" type="submit">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <>
              <Link href="/signin">
                <Button size="sm" variant="ghost">
                  Sign in
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
