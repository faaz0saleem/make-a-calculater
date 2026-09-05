/**
 * The wizard frame: the ten steps down the side, with what is done and what is
 * not. Progress comes from the profile itself (`wizardProgress`), so it is
 * always accurate — there is no stored "current step" to fall out of sync.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { loadWizardSnapshot } from '@/db/tutors';
import { requireRole } from '@/lib/auth/guards';
import { wizardProgress } from '@/lib/tutors/wizard';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Become a tutor' };

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('tutor');
  const snapshot = await loadWizardSnapshot(user.id);
  if (!snapshot) redirect('/tutor');

  const progress = wizardProgress(snapshot);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Onboarding steps" className="flex flex-col gap-1">
          <div className="mb-3">
            <p className="text-sm font-medium">
              {progress.completedRequired} of {progress.totalRequired} steps done
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.round((progress.completedRequired / progress.totalRequired) * 100)}%`,
                }}
              />
            </div>
          </div>

          {progress.steps.map((step) => (
            <Link
              key={step.slug}
              href={`/tutor/onboarding/${step.slug}`}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                'hover:bg-secondary',
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                    step.state === 'complete'
                      ? 'bg-[var(--success)] text-[var(--success-foreground)]'
                      : 'border border-border text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {step.state === 'complete' ? '✓' : step.number}
                </span>
                {step.title}
              </span>
              {step.optional ? (
                <Badge variant="outline" className="text-[10px]">
                  optional
                </Badge>
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="min-w-0">{children}</div>
      </main>
    </>
  );
}
