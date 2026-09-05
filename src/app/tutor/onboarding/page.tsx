import { redirect } from 'next/navigation';

import { loadWizardSnapshot } from '@/db/tutors';
import { requireRole } from '@/lib/auth/guards';
import { wizardProgress } from '@/lib/tutors/wizard';

export const dynamic = 'force-dynamic';

/** "Resume" — sends the tutor to the first step that is not finished. */
export default async function OnboardingIndex() {
  const user = await requireRole('tutor');
  const snapshot = await loadWizardSnapshot(user.id);
  if (!snapshot) redirect('/tutor');

  redirect(`/tutor/onboarding/${wizardProgress(snapshot).resumeSlug}`);
}
