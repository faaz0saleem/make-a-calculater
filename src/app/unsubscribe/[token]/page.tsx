/**
 * One tap, no sign-in (SPEC.md §11).
 *
 * The token is the authority — an HMAC over the user and the kind — because an
 * unsubscribe link that asks for a password is not an unsubscribe link. Somebody
 * reading on a phone who cannot make it work in one tap marks the message as
 * spam instead, and that costs the sending domain far more than the preference
 * ever would.
 *
 * It is a GET that changes state, which is normally wrong and is right here:
 * mail clients pre-fetch, and `List-Unsubscribe-Post` one-click sends a POST to
 * the same URL. Both should end with the person unsubscribed. Nothing else on
 * this route can be done with the token — it cannot subscribe, read or reach an
 * operational message.
 */

import Link from 'next/link';

import { unsubscribe } from '@/db/email';
import { EMAIL_KIND_LABELS } from '@/lib/email/kinds';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unsubscribed', robots: { index: false, follow: false } };

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const verified = verifyUnsubscribeToken(token);

  if (verified) await unsubscribe(verified.userId, verified.target);

  const what =
    verified && verified.target !== 'all'
      ? EMAIL_KIND_LABELS[verified.target].title.toLowerCase()
      : 'optional';

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-6 py-16">
      <p className="text-xl font-bold tracking-tight">Tutorly.</p>

      {verified ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">That is switched off</h1>
          <p className="text-sm leading-6">
            You will not get another <strong>{what}</strong> email. It takes effect immediately, and
            one may still be in flight from before you tapped this.
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Records of your money and your account — a payout, a cancellation, a verification
            decision — still arrive. Those are not marketing, and switching them off would mean
            finding out weeks late.
          </p>
          <p className="text-sm">
            <Link href="/settings/email" className="underline underline-offset-4">
              Change what else we send
            </Link>
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">That link did not work</h1>
          <p className="text-sm leading-6">
            It may have been cut in half by a mail client, or it may be from an old email after a
            security change. Nothing has been changed.
          </p>
          <p className="text-sm">
            <Link href="/settings/email" className="underline underline-offset-4">
              Sign in and set your email preferences
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
