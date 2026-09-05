/**
 * The moderation queue (SPEC.md §8, §10).
 *
 * Four things, in the order somebody working through them should meet them:
 * reports a person filed, contact-info flags a scorer raised, appeals waiting
 * for an answer, and the behavioural signal that no single message can show.
 *
 * The contact-info section is the one with a design opinion in it. It shows the
 * score, and then it shows the reasons behind the score in plain English, and
 * then it shows what the machine deliberately *ignored* — "3 numbers left alone
 * — question, page, equation or time". A reviewer who can see what was ignored
 * can calibrate how much to trust the rest; one who sees only "94%" cannot, and
 * will either rubber-stamp everything or stop reading.
 *
 * Dismiss is the leftmost, cheapest button on every flag, and takes no reason.
 * That is deliberate.
 */

import Link from 'next/link';

import {
  decideAppealAction,
  decideContactFlagAction,
  resolveReportAction,
} from '@/app/admin/reports/actions';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  appealQueue,
  contactFlagQueue,
  quietPairSignals,
  reportQueue,
  QUIET_AFTER_SESSIONS,
  QUIET_DAYS,
} from '@/db/reports';
import { requireRole } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { actionsFor, REPORT_TARGET_LABELS } from '@/lib/moderation/reports';
import { SANCTION_COPY, type SanctionLevel } from '@/lib/moderation/sanctions';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Moderation queue' };

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const admin = await requireRole('admin');
  const query = await searchParams;

  const [open, flags, appeals, quiet] = await Promise.all([
    reportQueue(),
    contactFlagQueue('pending'),
    appealQueue(),
    quietPairSignals(15),
  ]);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Moderation queue</h1>
          <Link href="/admin" className="text-sm text-muted-foreground underline underline-offset-4">
            Back to admin
          </Link>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}
        {query.done ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm" data-testid="queue-done">
            {query.done}
          </p>
        ) : null}

        {/* ------------------------------------------------------------- */}
        {/* Reports somebody filed                                         */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Reports</CardTitle>
            <CardDescription>
              {open.length === 0 ? 'Nothing waiting.' : `${open.length} waiting, oldest first.`}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody has reported anything.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {open.map((report) => (
                  <li key={report.id} className="flex flex-col gap-3 py-4" data-testid="report-row">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {report.targetLabel ?? 'Something that no longer exists'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {REPORT_TARGET_LABELS[report.targetType] ?? report.targetType} · reported by{' '}
                          {report.reporterName ?? 'a deleted account'} ·{' '}
                          {formatInTimeZone(report.createdAt, admin.timezone)}
                        </p>
                      </div>
                      {report.subjectId && report.priorSanctions > 0 ? (
                        <Badge variant="destructive">
                          {report.priorSanctions} previous notice
                          {report.priorSanctions === 1 ? '' : 's'}
                        </Badge>
                      ) : null}
                    </div>

                    <p className="text-sm">
                      <strong className="font-medium">{report.reason}</strong>
                      {report.body ? <span className="block text-muted-foreground">{report.body}</span> : null}
                    </p>

                    {report.href ? (
                      <Link
                        href={report.href}
                        className="text-xs underline underline-offset-4"
                        data-testid="report-context"
                      >
                        Go and look
                      </Link>
                    ) : null}

                    <form action={resolveReportAction} className="flex flex-col gap-2">
                      <input type="hidden" name="reportId" value={report.id} />
                      <input type="hidden" name="subjectId" value={report.subjectId ?? ''} />

                      <label className="text-xs font-medium" htmlFor={`why-${report.id}`}>
                        Why. Both sides read this.
                      </label>
                      <Textarea id={`why-${report.id}`} name="reason" rows={2} required />

                      <div className="flex flex-wrap gap-2">
                        {actionsFor(report.targetType, report.subjectId !== null).map((action) => (
                          <Button
                            key={action.id}
                            type="submit"
                            name="action"
                            value={action.id}
                            size="sm"
                            variant={action.sanction ? 'outline' : 'secondary'}
                            title={action.blurb}
                            data-testid={`report-${action.id}`}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {report.subjectId
                          ? 'A warning changes nothing about their account. A restriction stops new trial requests and the ranking boost for 30 days, and leaves every existing student where they are.'
                          : 'This report is not about one person, so no notice can be sent from here. Money questions about a session go to the dispute queue.'}
                      </p>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* Contact-info flags                                             */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Possible contact-info attempts</CardTitle>
            <CardDescription>
              Scored on the way past, never acted on. Every one of these messages was delivered
              normally — the score decides only whether you see it.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {flags.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scored high enough to show you.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {flags.map((flag) => (
                  <li key={flag.id} className="flex flex-col gap-3 py-4" data-testid="contact-flag">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-medium" data-testid="flag-sender">
                          {flag.senderName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatInTimeZone(flag.createdAt, admin.timezone)} ·{' '}
                          {flag.priorConfirmed} confirmed before this
                        </p>
                      </div>
                      <Badge variant="secondary" data-testid="flag-score">
                        {flag.score} / 100
                      </Badge>
                    </div>

                    <blockquote className="rounded-md bg-secondary px-3 py-2 text-sm">
                      {flag.raw}
                    </blockquote>
                    <p className="text-xs text-muted-foreground">
                      What the other side saw: {flag.masked}
                    </p>

                    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {flag.signals.map((signal) => (
                        <li key={signal.id}>
                          <span className="tabular-nums">
                            {signal.weight > 0 ? `+${signal.weight}` : '  0'}
                          </span>{' '}
                          {signal.note}
                        </li>
                      ))}
                    </ul>

                    <form action={decideContactFlagAction} className="flex flex-col gap-2">
                      <input type="hidden" name="flagId" value={flag.id} />

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          name="verdict"
                          value="dismiss"
                          size="sm"
                          variant="secondary"
                          data-testid="dismiss-flag"
                        >
                          Not an attempt
                        </Button>
                        <Button
                          type="submit"
                          name="verdict"
                          value="confirm"
                          size="sm"
                          variant="outline"
                          data-testid="confirm-flag-only"
                        >
                          Confirm, no notice
                        </Button>
                      </div>

                      <details className="text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          Confirm and send a notice — next step is a{' '}
                          <strong>{SANCTION_COPY[flag.suggested].action.toLowerCase()}</strong>
                        </summary>

                        <div className="mt-2 flex flex-col gap-2">
                          <label className="text-xs font-medium" htmlFor={`note-${flag.id}`}>
                            What they will read, word for word.
                          </label>
                          <Textarea id={`note-${flag.id}`} name="reason" rows={3} />

                          <input type="hidden" name="verdict" value="confirm" />

                          <div className="flex flex-wrap gap-2">
                            {(['warning', 'restriction', 'review'] as SanctionLevel[]).map((level) => (
                              <Button
                                key={level}
                                type="submit"
                                name="level"
                                value={level}
                                size="sm"
                                variant={level === flag.suggested ? 'default' : 'outline'}
                                data-testid={`sanction-${level}`}
                              >
                                {SANCTION_COPY[level].action}
                              </Button>
                            ))}
                          </div>

                          <p className="text-xs text-muted-foreground">
                            {SANCTION_COPY[flag.suggested].adminWarning}
                          </p>
                        </div>
                      </details>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* Appeals                                                        */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Appeals</CardTitle>
            <CardDescription>Every notice can be appealed, including a warning.</CardDescription>
          </CardHeader>
          <CardContent>
            {appeals.length === 0 ? (
              <p className="text-sm text-muted-foreground">None waiting.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {appeals.map((appeal) => (
                  <li key={appeal.id} className="flex flex-col gap-2 py-4" data-testid="appeal-row">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">{appeal.userName}</p>
                      <Badge variant="outline">{SANCTION_COPY[appeal.level].action}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      We told them: {appeal.reason}
                    </p>
                    <blockquote className="rounded-md bg-secondary px-3 py-2 text-sm">
                      {appeal.appealNote}
                    </blockquote>

                    <form action={decideAppealAction} className="flex flex-col gap-2">
                      <input type="hidden" name="sanctionId" value={appeal.id} />
                      <label className="text-xs font-medium" htmlFor={`outcome-${appeal.id}`}>
                        Your answer. They read this.
                      </label>
                      <Textarea id={`outcome-${appeal.id}`} name="outcome" rows={2} required />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          name="uphold"
                          value="no"
                          size="sm"
                          data-testid="lift-sanction"
                        >
                          Lift it
                        </Button>
                        <Button
                          type="submit"
                          name="uphold"
                          value="yes"
                          size="sm"
                          variant="outline"
                          data-testid="uphold-sanction"
                        >
                          Keep it
                        </Button>
                      </div>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* The behavioural signal                                         */}
        {/* ------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Pairs that went quiet</CardTitle>
            <CardDescription>
              Students who completed {QUIET_AFTER_SESSIONS} or more sessions with one tutor, then
              stopped booking anyone here for {QUIET_DAYS} days. One is somebody who passed their
              exam. A column of them beside a low active count is a pattern, and no single message
              would ever have shown it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {quiet.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tutor has an established pair that has gone quiet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-140 text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Tutor</th>
                      <th className="py-2 pr-3 text-right font-medium">Quiet</th>
                      <th className="py-2 pr-3 text-right font-medium">Still active</th>
                      <th className="py-2 pr-3 text-right font-medium">Share</th>
                      <th className="py-2 text-right font-medium">Was worth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quiet.map((row) => (
                      <tr
                        key={row.tutorId}
                        className="border-b border-border last:border-0"
                        data-testid="quiet-pair-row"
                      >
                        <td className="py-2 pr-3">
                          <Link
                            href={`/tutors/${row.tutorId}`}
                            className="underline underline-offset-4"
                          >
                            {row.tutorName}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.quietPairs}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.activePairs}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {(row.quietBps / 100).toFixed(0)}%
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatCents(row.lostGmvCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              This is a signal, not a finding. Nothing on this page acts on it — read it beside the
              tutor&rsquo;s messages and reviews before you decide it means anything.
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
