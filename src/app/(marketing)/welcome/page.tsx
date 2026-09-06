import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { pageMetadata } from '@/lib/seo/site';
import { PublicShell } from '../_components/public-shell';
import { SignedOutIntro } from '../_components/signed-out-intro';

export const metadata = pageMetadata('Meet your next tutor', 'Browse Tutorly by curriculum and learn how to choose your next online lesson.', '/welcome', false);
export const dynamic = 'force-dynamic';

/** Preview for the new introduction; / remains owned by the existing feed. */
export default async function WelcomePage() {
  const session = await auth();
  if (session?.user) redirect('/');
  return <PublicShell><SignedOutIntro headingLevel={1} browseHref="/" /></PublicShell>;
}
