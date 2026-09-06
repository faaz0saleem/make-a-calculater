/**
 * What we may email you about (SPEC.md §11).
 *
 * Two halves, and the split is the honest part. The top half is switchable.
 * The bottom half is not, and rather than hide it the page lists it and says
 * why: you cannot turn off being told that your payout was sent or that a
 * lesson you paid for was cancelled. Showing a switch that does nothing would
 * be worse than showing no switch at all.
 */

import Link from 'next/link';

import { unsubscribeFromEverything, updateEmailPreferences } from '@/app/settings/email/actions';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { preferencesFor } from '@/db/email';
import { requireUser } from '@/lib/auth/guards';
import { EMAIL_KINDS, EMAIL_KIND_LABELS, isOptionalEmail } from '@/lib/email/kinds';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Email preferences' };

const DONE: Record<string, string> = {
  saved: 'Saved. New settings apply to the next email we send.',
  unsubscribed: 'Done — every optional email is off. Records of your money and your account still arrive.',
};

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const [user, query] = await Promise.all([requireUser(), searchParams]);
  const { unsubscribedAll, preferences } = await preferencesFor(user.id);
  const operational = EMAIL_KINDS.filter((kind) => !isOptionalEmail(kind));

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            We send as little as we can get away with. Everything below is off by one tap and back
            on by another.
          </p>
        </div>

        {query.done && DONE[query.done] ? (
          <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm" data-testid="email-saved">
            {DONE[query.done]}
          </p>
        ) : null}

        {unsubscribedAll ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-5 text-sm">
              <p>
                <strong>You are unsubscribed from every optional email.</strong> Individual settings
                below are remembered, and will apply again if you turn optional email back on.
              </p>
              <form action={updateEmailPreferences}>
                <input type="hidden" name="resubscribe" value="yes" />
                {preferences.map((preference) => (
                  <input key={preference.kind} type="hidden" name="kinds" value={preference.kind} />
                ))}
                {preferences
                  .filter((preference) => preference.enabled)
                  .map((preference) => (
                    <input key={preference.kind} type="hidden" name="enabled" value={preference.kind} />
                  ))}
                <Button type="submit" size="sm" data-testid="resubscribe">
                  Turn optional email back on
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <form action={updateEmailPreferences}>
          <Card>
            <CardHeader>
              <CardTitle as="h2">You can switch these off</CardTitle>
              <CardDescription>
                Reminders and news. The in-app bell keeps working whatever you choose here.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {preferences.map((preference) => (
                <label key={preference.kind} className="flex items-start gap-3 text-sm">
                  <input type="hidden" name="kinds" value={preference.kind} />
                  <input
                    type="checkbox"
                    name="enabled"
                    value={preference.kind}
                    defaultChecked={preference.enabled}
                    disabled={unsubscribedAll}
                    className="mt-1 h-4 w-4 accent-[var(--primary)]"
                    data-testid={`email-pref-${preference.kind}`}
                  />
                  <span>
                    <span className="font-medium">{EMAIL_KIND_LABELS[preference.kind].title}</span>
                    <span className="block text-muted-foreground">
                      {EMAIL_KIND_LABELS[preference.kind].description}
                    </span>
                  </span>
                </label>
              ))}

              <Button
                type="submit"
                size="sm"
                className="self-start"
                disabled={unsubscribedAll}
                data-testid="save-email-prefs"
              >
                Save
              </Button>
            </CardContent>
          </Card>
        </form>

        <Card>
          <CardHeader>
            <CardTitle as="h2">These always arrive</CardTitle>
            <CardDescription>
              Records of something that happened to your money or your account. There is no switch
              for them, and we would rather say so than show one that does nothing.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {operational.map((kind) => (
                <li key={kind}>
                  <span className="font-medium">{EMAIL_KIND_LABELS[kind].title}</span>
                  <span className="block text-muted-foreground">
                    {EMAIL_KIND_LABELS[kind].description}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {!unsubscribedAll ? (
          <form action={unsubscribeFromEverything}>
            <Button type="submit" variant="outline" size="sm" data-testid="unsubscribe-all">
              Unsubscribe from every optional email
            </Button>
          </form>
        ) : null}

        <Link href="/dashboard" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to your dashboard
        </Link>
      </main>
    </>
  );
}
