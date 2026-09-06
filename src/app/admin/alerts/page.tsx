/**
 * What needs you right now (SPEC.md §10, §14).
 *
 * The first screen to open, from a phone, before looking at anything else. It
 * is deliberately not a dashboard: no charts, no totals, nothing that is
 * interesting rather than urgent. When nothing is wrong it says so in one line
 * and stops — a page that always has something on it is a page you stop
 * reading.
 *
 * Every alert says what to do, not what was counted, and links to the heading
 * in `RUNBOOK.md` that walks through it.
 */

import Link from 'next/link';

import { retryDeadLetterAction } from '@/app/admin/alerts/actions';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { activeAlerts } from '@/db/alerts';
import { deadLetters, emailQueueHealth } from '@/db/email';
import { requireRole } from '@/lib/auth/guards';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Alerts' };

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const admin = await requireRole('admin');
  const query = await searchParams;

  const [alerts, letters, mail] = await Promise.all([
    activeAlerts(),
    deadLetters(25),
    emailQueueHealth(),
  ]);

  const critical = alerts.filter((alert) => alert.severity === 'critical');
  const warnings = alerts.filter((alert) => alert.severity === 'warning');

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Checked live, just now. Nothing here is cached, so a refresh is the truth.
          </p>
        </div>

        {query.done === 'requeued' ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm" data-testid="alert-done">
            Back in the queue. The next drain will try it again from zero attempts.
          </p>
        ) : null}

        {alerts.length === 0 ? (
          <Card data-testid="all-clear">
            <CardContent className="p-5 text-sm">
              <p className="font-medium">Nothing needs you.</p>
              <p className="mt-1 text-muted-foreground">
                The ledger reconciles, settlement is current, no payout is stuck, and the email queue
                is draining.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {[
          ['Now', critical] as const,
          ['Soon', warnings] as const,
        ].map(([heading, list]) =>
          list.length === 0 ? null : (
            <section key={heading} className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>

              {list.map((alert) => (
                <Card key={alert.id} data-testid={`alert-${alert.id}`}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={alert.severity === 'critical' ? 'destructive' : 'secondary'}>
                        {alert.severity === 'critical' ? 'Now' : 'Soon'}
                      </Badge>
                      <CardTitle as="h3">{alert.title}</CardTitle>
                    </div>
                    <CardDescription>{alert.detail}</CardDescription>
                  </CardHeader>

                  <CardContent className="flex flex-wrap items-center gap-3 text-sm">
                    {alert.href ? (
                      <Link href={alert.href}>
                        <Button size="sm" variant="outline">
                          Open it
                        </Button>
                      </Link>
                    ) : null}
                    <a
                      className="underline underline-offset-4"
                      href={`https://github.com/faaz0saleem/make-a-calculater/blob/main/RUNBOOK.md#${alert.runbook}`}
                    >
                      What to do
                    </a>
                  </CardContent>
                </Card>
              ))}
            </section>
          ),
        )}

        <Card id="dead-letters" className="scroll-mt-6">
          <CardHeader>
            <CardTitle as="h2">Email</CardTitle>
            <CardDescription>
              {mail.sentLastDay} sent in the last day · {mail.queued} queued · {mail.dead} gave up
              {mail.oldestQueuedMinutes !== null
                ? ` · oldest queued ${mail.oldestQueuedMinutes} min`
                : ''}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {letters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No dead letters. Every message that was queued has been delivered or is waiting its
                turn.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {letters.map((letter) => (
                  <li key={letter.id} className="flex flex-col gap-2 py-3" data-testid="dead-letter">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{letter.subject}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatInTimeZone(letter.createdAt, admin.timezone)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {letter.kind} · {letter.userName ?? 'unknown'} · {letter.toEmail} ·{' '}
                      {letter.attempts} attempts
                    </p>
                    {letter.lastError ? (
                      <p className="rounded bg-secondary px-2 py-1 font-mono text-xs">
                        {letter.lastError}
                      </p>
                    ) : null}
                    <form action={retryDeadLetterAction}>
                      <input type="hidden" name="id" value={letter.id} />
                      <Button type="submit" size="sm" variant="outline" data-testid="retry-dead-letter">
                        Try again
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/admin" className="underline underline-offset-4">
            The numbers
          </Link>
          <Link href="/api/health" className="underline underline-offset-4">
            Health check
          </Link>
        </div>
      </main>
    </>
  );
}
