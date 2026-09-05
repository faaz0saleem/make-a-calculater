/**
 * The verification queue (SPEC.md §10).
 */

import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loadVerificationQueue } from '@/db/tutors';
import { requireRole } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Verification queue' };

const DECIDED_COPY: Record<string, string> = {
  approved: 'Tutor verified. They now appear in the feed.',
  rejected: 'Tutor rejected. They can fix the problem and submit again.',
};

export default async function VerificationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ decided?: string }>;
}) {
  const admin = await requireRole('admin');
  const { decided } = await searchParams;
  const queue = await loadVerificationQueue();

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Verification queue</h1>
          <Link href="/admin" className="text-sm text-muted-foreground underline underline-offset-4">
            Back to admin
          </Link>
        </div>

        {decided && DECIDED_COPY[decided] ? (
          <p className="rounded-md bg-secondary px-3 py-2 text-sm">{DECIDED_COPY[decided]}</p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Awaiting review</CardTitle>
            <CardDescription>
              {queue.length === 0 ? 'Nothing waiting.' : `${queue.length} tutor${queue.length === 1 ? '' : 's'}, oldest first.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">The queue is empty.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {queue.map((tutor) => (
                  <li key={tutor.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">{tutor.name}</p>
                      <p className="text-muted-foreground">
                        {tutor.email} · {tutor.country ?? '—'} · {formatCents(tutor.hourlyCents)}/hr
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Submitted{' '}
                        {tutor.submittedAt ? formatInTimeZone(tutor.submittedAt, admin.timezone) : 'unknown'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">
                        {tutor.credentialCount} document{tutor.credentialCount === 1 ? '' : 's'}
                      </Badge>
                      <Link href={`/admin/verification/${tutor.id}`}>
                        <Button size="sm">Review</Button>
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
