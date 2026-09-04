/**
 * Credit pack prices (SPEC.md §2).
 *
 * The table the checkout reads, edited here rather than in a constant, so a
 * price change is a form submission and not a deploy. Existing purchases keep
 * the amounts they were made at — `credit_purchases` snapshots both numbers.
 */

import { asc } from 'drizzle-orm';

import { saveCreditPack } from '@/app/admin/packs/actions';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db/client';
import { creditPacks } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Credit packs' };

export default async function PacksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireRole('admin');
  const query = await searchParams;

  const packs = await db.select().from(creditPacks).orderBy(asc(creditPacks.sortOrder));

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Credit packs</h1>
          <p className="text-sm text-muted-foreground">
            What a student pays, and what lands in their wallet. Both are snapshotted onto every purchase,
            so changing them here never touches a purchase already made.
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {query.saved ? (
          <p role="status" className="rounded-md bg-[var(--success)]/10 px-4 py-3 text-sm">
            Saved. The change is live on the credits page.
          </p>
        ) : null}

        {packs.map((pack) => (
          <Card key={pack.id}>
            <CardHeader>
              <CardTitle>{pack.name}</CardTitle>
              <CardDescription>
                Currently {formatCents(pack.paidCents)} for {formatCents(pack.creditsCents)} of credits.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form action={saveCreditPack} className="flex flex-wrap items-end gap-3 text-sm">
                <input type="hidden" name="packId" value={pack.id} />

                <label className="flex flex-col gap-1">
                  <span>Price (cents)</span>
                  <input
                    name="paidCents"
                    type="number"
                    min={100}
                    step={1}
                    defaultValue={pack.paidCents}
                    className="min-h-11 w-32 rounded-md border border-input bg-transparent px-3 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span>Credits (cents)</span>
                  <input
                    name="creditsCents"
                    type="number"
                    min={100}
                    step={1}
                    defaultValue={pack.creditsCents}
                    className="min-h-11 w-32 rounded-md border border-input bg-transparent px-3 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                <label className="flex items-center gap-2 pb-3">
                  <input type="checkbox" name="active" defaultChecked={pack.active} className="size-4" />
                  On sale
                </label>

                <Button type="submit" size="sm" className="min-h-11">
                  Save
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </main>
    </>
  );
}
