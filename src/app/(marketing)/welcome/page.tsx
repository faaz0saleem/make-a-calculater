import { redirect } from 'next/navigation';

import { currentUser } from '@/lib/auth/guards';
import { pageMetadata } from '@/lib/seo/site';
import { PublicShell } from '../_components/public-shell';
import { SignedOutIntro } from '../_components/signed-out-intro';

export const metadata = pageMetadata('Meet your next tutor', 'Browse Tutorly by curriculum and learn how to choose your next online lesson.', '/welcome', false);
export const dynamic = 'force-dynamic';

/** Preview for the new introduction; / remains owned by the existing feed. */
export default async function WelcomePage() {
  if (await currentUser()) redirect('/');
  return <PublicShell><SignedOutIntro headingLevel={1} browseHref="/" /></PublicShell>;
}
