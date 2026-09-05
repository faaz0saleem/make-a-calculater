import Link from 'next/link';

import { auth, signOut } from '@/auth';
import { unreadCount } from '@/db/notifications';
import { pendingNoticeFor } from '@/db/reports';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { defaultLandingPath } from '@/lib/auth/roles';

export async function SiteHeader() {
  const session = await auth();
  const roles = session?.user?.roles ?? [];
  const unread = session?.user?.id ? await unreadCount(session.user.id) : 0;

  // Only rendered when there is one. A warning somebody has to acknowledge is
  // not something to bury behind a settings page, and a nav item that is always
  // there stops being noticed.
  const notice = session?.user?.id ? await pendingNoticeFor(session.user.id) : null;

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Tutorly
        </Link>

        <nav className="flex items-center gap-2 text-sm sm:gap-3">
          {session?.user ? (
            <>
              {/* Email and roles are context, not navigation: on a 360px phone
                  the buttons win the space. */}
              <span className="hidden text-muted-foreground sm:inline">{session.user.email}</span>
              {roles.map((role) => (
                <Badge key={role} variant="secondary" className="hidden sm:inline-flex">
                  {role}
                </Badge>
              ))}
              {notice ? (
                <Link href="/settings/notices" data-testid="notice-nudge">
                  <Button size="sm" variant="destructive">
                    Notice
                  </Button>
                </Link>
              ) : null}
              <Link href="/messages" className="hidden sm:block">
                <Button size="sm" variant="ghost">
                  Messages
                </Button>
              </Link>
              <Link
                href="/notifications"
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                className="relative inline-flex min-h-11 items-center rounded-md px-2 text-lg hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden>🔔</span>
                {unread > 0 ? (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 top-1 rounded-full bg-primary px-1.5 text-[11px] font-medium leading-4 text-primary-foreground"
                  >
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
              </Link>
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
