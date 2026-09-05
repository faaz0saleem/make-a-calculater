/**
 * The in-app bell (SPEC.md §11).
 *
 * Email templates arrive in Phase 7 and will read the same rows. Opening this
 * page is what marks them read — there is no separate "mark all read" to press,
 * because there is nothing here you can act on twice.
 */

import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { listNotifications, markNotificationsRead } from '@/db/notifications';
import { requireUser } from '@/lib/auth/guards';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await listNotifications(user.id);

  // Read directly rather than through a Server Action: nothing may revalidate
  // during a render.
  await markNotificationsRead(user.id);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">Shown in {user.timezone}.</p>
        </div>

        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing yet. Trial requests, replies, reviews and new times from tutors you follow land here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {items.map((item) => {
              const row = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.title}</span>
                      {item.readAt ? null : <Badge variant="default">new</Badge>}
                    </span>
                    {item.body ? (
                      <span className="block text-sm text-muted-foreground">{item.body}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatInTimeZone(item.createdAt, user.timezone)}
                  </span>
                </>
              );

              return (
                <li key={item.id} data-testid="notification">
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
