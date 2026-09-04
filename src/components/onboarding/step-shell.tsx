import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { nextStep, previousStep, type WizardStep } from '@/lib/tutors/wizard';

/**
 * The frame every step renders inside: title, the save banner or the error the
 * action redirected back with, and the previous/next links.
 */
export function StepShell({
  step,
  error,
  saved,
  children,
  footer,
}: {
  step: WizardStep;
  error?: string;
  saved?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const back = previousStep(step.slug);
  const forward = nextStep(step.slug);

  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {step.number} of 10
        </p>
        <CardTitle as="h1" className="text-xl">{step.title}</CardTitle>
        <CardDescription>{step.blurb}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {saved && !error ? (
          <p className="rounded-md bg-[var(--success)]/10 px-3 py-2 text-sm text-[var(--success)]">
            Saved.
          </p>
        ) : null}

        {children}

        {footer ?? (
          <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
            {back ? (
              <Link href={`/tutor/onboarding/${back.slug}`}>
                <Button variant="ghost" size="sm" type="button">
                  ← {back.title}
                </Button>
              </Link>
            ) : (
              <span />
            )}
            {forward ? (
              <Link href={`/tutor/onboarding/${forward.slug}`} className="text-muted-foreground underline underline-offset-4">
                Skip to {forward.title}
              </Link>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
