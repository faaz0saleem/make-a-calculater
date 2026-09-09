/**
 * The nudge to confirm an address (SPEC.md §1).
 *
 * A banner and not a modal, and the difference is the whole decision. Nothing
 * on Tutorly is blocked by an unconfirmed address until money moves, so a
 * dialogue that has to be dismissed before the page can be used would be
 * lying about how much it matters. This sits under the header, says what it
 * actually affects, and can be put away.
 *
 * Rendered by `SiteHeader`, so it follows somebody around the product rather
 * than living on one settings page they have no reason to open.
 */

import Link from 'next/link';
import { cookies } from 'next/headers';

import { dismissVerifyBannerAction, resendVerificationAction } from '@/app/settings/email/actions';
import { Button } from '@/components/ui/button';
import { VERIFY_BANNER_COOKIE, VERIFIED_PURCHASE_THRESHOLD_CENTS } from '@/lib/auth/verification';
import { formatCents } from '@/lib/money/cents';

export async function VerifyEmailBanner({ email }: { email: string }) {
  const dismissed = (await cookies()).get(VERIFY_BANNER_COOKIE)?.value === '1';
  if (dismissed) return null;

  return (
    <div className="border-b border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
        <p className="text-amber-900 dark:text-amber-100" data-testid="verify-banner">
          <span className="font-medium">Confirm {email}.</span>{' '}
          <span className="text-amber-800 dark:text-amber-200/90">
            Everything works without it except payouts and purchases over{' '}
            {formatCents(VERIFIED_PURCHASE_THRESHOLD_CENTS)}.
          </span>
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <form action={resendVerificationAction}>
            <Button size="sm" type="submit" data-testid="verify-resend">
              Send the link
            </Button>
          </form>
          <form action={dismissVerifyBannerAction}>
            <Button size="sm" variant="ghost" type="submit" data-testid="verify-dismiss">
              Not now
            </Button>
          </form>
          <Link href="/settings/email" className="hidden text-xs underline underline-offset-4 sm:inline">
            Wrong address?
          </Link>
        </div>
      </div>
    </div>
  );
}
