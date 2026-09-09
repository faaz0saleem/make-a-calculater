import Link from 'next/link';

import { signOut } from '@/auth';
import { unreadCount } from '@/db/notifications';
import { pendingNoticeFor } from '@/db/reports';
import { verificationStatus } from '@/db/verification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VerifyEmailBanner } from '@/components/verify-email-banner';
import { currentUser } from '@/lib/auth/guards';
import { defaultLandingPath } from '@/lib/auth/roles';

export async function SiteHeader() {
  // The guard, not `auth()`. A session revoked by a password reset still has a
  // cookie; rendering a signed-in header for it offers links every one of
  // which bounces to sign-in.
  const user = await currentUser();
  const roles = user?.roles ?? [];
  const unread = user ? await unreadCount(user.id) : 0;

  // Only rendered when there is one. A warning somebody has to acknowledge is
  // not something to bury behind a settings page, and a nav item that is always
  // there stops being noticed.
  const notice = user ? await pendingNoticeFor(user.id) : null;

  // Read from the database rather than from the token, because the token holds
  // whatever the address was when it was issued — somebody who has just changed
  // theirs would otherwise see the old one in the header until they signed in
  // again, and the banner below would be about the wrong address.
  const account = user ? await verificationStatus(user.id) : null;

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Tutorly
        </Link>

        <nav className="flex items-center gap-2 text-sm sm:gap-3">
          {user ? (
            <>
              {/* Email and roles are context, not navigation: on a 360px phone
                  the buttons win the space. */}
              <span className="hidden text-muted-foreground sm:inline">
                {account?.email ?? user.email}
              </span>
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

      {account && !account.verified ? <VerifyEmailBanner email={account.email} /> : null}
    </header>
  );
}
