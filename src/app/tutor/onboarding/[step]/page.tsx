/**
 * One page per wizard step.
 *
 * The page loads only what that step needs and hands it to the form. Every form
 * posts to a server action in `../actions.ts`, which validates, saves the draft
 * and redirects — back here with a message if something was wrong, forward if
 * it was fine.
 */

import { asc, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { AccountStep, IdentityStep, ProfileStep, VideoStep } from '@/components/onboarding/steps-1-4';
import { CredentialsStep, RatesStep, SubjectsStep } from '@/components/onboarding/steps-5-7';
import { AvailabilityStep, PayoutStep, ReviewStep } from '@/components/onboarding/steps-8-10';
import { StepShell } from '@/components/onboarding/step-shell';
import { db } from '@/db/client';
import {
  availabilityExceptions,
  availabilityRules,
  credentials,
  payoutMethods,
  subjects,
  tutorLanguages,
  tutorProfiles,
  tutorSubjects,
  users,
  videos,
} from '@/db/schema';
import { curriculumContextFor, getTutorCurriculum, MAX_TUTOR_CURRICULUM } from '@/db/curriculum';
import { loadWizardSnapshot } from '@/db/tutors';
import { TutorPositions } from '@/components/curriculum/tutor-positions';
import { requireRole } from '@/lib/auth/guards';
import { findStep, wizardProgress } from '@/lib/tutors/wizard';

export const dynamic = 'force-dynamic';

export default async function WizardStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ step: string }>;
  searchParams: Promise<{ error?: string; saved?: string; curriculumError?: string }>;
}) {
  const { step: slug } = await params;
  const step = findStep(slug);
  if (!step) notFound();

  const user = await requireRole('tutor');
  const snapshot = await loadWizardSnapshot(user.id);
  if (!snapshot) redirect('/tutor');

  const { error, saved, curriculumError } = await searchParams;
  const shell = { step, error, saved: saved === '1' };

  switch (step.slug) {
    case 'account': {
      const [account] = await db
        .select({ email: users.email, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      return (
        <StepShell {...shell}>
          <AccountStep email={account?.email ?? ''} emailVerified={account?.emailVerified !== null} />
        </StepShell>
      );
    }

    case 'identity': {
      const languages = await db
        .select({ languageCode: tutorLanguages.languageCode, proficiency: tutorLanguages.proficiency })
        .from(tutorLanguages)
        .where(eq(tutorLanguages.tutorId, user.id));

      return (
        <StepShell {...shell}>
          <IdentityStep
            name={snapshot.name}
            country={snapshot.country}
            city={snapshot.city}
            timezone={snapshot.timezone ?? 'UTC'}
            languages={languages}
          />
        </StepShell>
      );
    }

    case 'profile':
      return (
        <StepShell {...shell}>
          <ProfileStep headline={snapshot.headline} bio={snapshot.bio} avatarUrl={snapshot.avatarUrl} />
        </StepShell>
      );

    case 'video': {
      const [video] = await db
        .select({
          status: videos.status,
          previewUrl: videos.previewUrl,
          heroUrl: videos.heroUrl,
          thumbnailUrl: videos.thumbnailUrl,
          thumbnailCandidates: videos.thumbnailCandidates,
          durationS: videos.durationS,
          error: videos.error,
        })
        .from(videos)
        .innerJoin(tutorProfiles, eq(tutorProfiles.introVideoId, videos.id))
        .where(eq(tutorProfiles.userId, user.id))
        .limit(1);

      return (
        <StepShell {...shell}>
          <VideoStep
            status={video?.status ?? 'missing'}
            previewUrl={video?.previewUrl ?? null}
            heroUrl={video?.heroUrl ?? null}
            posterUrl={video?.thumbnailUrl ?? null}
            candidates={video?.thumbnailCandidates ?? []}
            durationS={video?.durationS ?? null}
            error={video?.error ?? null}
          />
        </StepShell>
      );
    }

    case 'subjects': {
      const [allSubjects, chosen, context, positions] = await Promise.all([
        db
          .select({ id: subjects.id, slug: subjects.slug, name: subjects.name })
          .from(subjects)
          .orderBy(asc(subjects.sortOrder), asc(subjects.name)),
        db
          .select({
            subjectId: tutorSubjects.subjectId,
            level: tutorSubjects.level,
            yearsExperience: tutorSubjects.yearsExperience,
          })
          .from(tutorSubjects)
          .where(eq(tutorSubjects.tutorId, user.id)),
        curriculumContextFor(user.id, null),
        getTutorCurriculum(user.id),
      ]);

      // Only the subjects already saved: a board and class have to be *for*
      // something, and offering a subject the tutor has not claimed would let
      // the two lists tell a student different stories.
      const declaredSubjectIds = new Set(chosen.map((row) => row.subjectId));
      const declaredSubjects = allSubjects.filter((subject) => declaredSubjectIds.has(subject.id));

      return (
        <StepShell {...shell}>
          <div className="flex flex-col gap-8">
            <SubjectsStep subjects={allSubjects} chosen={chosen} />

            <section className="flex flex-col gap-3 border-t border-border pt-6">
              <h2 className="text-sm font-semibold">Boards and classes</h2>
              <TutorPositions
                boards={context.boards}
                subjects={declaredSubjects}
                positions={positions.map((position) => ({
                  boardId: position.boardId,
                  levelId: position.levelId,
                  subjectSlug: position.subjectSlug,
                }))}
                max={MAX_TUTOR_CURRICULUM}
                returnTo="/tutor/onboarding/subjects"
                error={curriculumError ?? null}
              />
            </section>
          </div>
        </StepShell>
      );
    }

    case 'credentials': {
      const documents = await db
        .select({
          id: credentials.id,
          kind: credentials.kind,
          title: credentials.title,
          institution: credentials.institution,
          year: credentials.year,
          status: credentials.status,
        })
        .from(credentials)
        .where(eq(credentials.tutorId, user.id))
        .orderBy(asc(credentials.createdAt));

      return (
        <StepShell {...shell}>
          <CredentialsStep documents={documents} isVerified={snapshot.status === 'verified'} />
        </StepShell>
      );
    }

    case 'rates': {
      const [profile] = await db
        .select({
          hourlyCents: tutorProfiles.hourlyCents,
          halfHourCents: tutorProfiles.halfHourCents,
          offersTrial: tutorProfiles.offersTrial,
          trialMinutes: tutorProfiles.trialMinutes,
          maxTrialsPerWeek: tutorProfiles.maxTrialsPerWeek,
        })
        .from(tutorProfiles)
        .where(eq(tutorProfiles.userId, user.id))
        .limit(1);

      return (
        <StepShell {...shell}>
          <RatesStep
            hourlyCents={profile?.hourlyCents ?? 2_500}
            halfHourCents={profile?.halfHourCents ?? 1_250}
            offersTrial={profile?.offersTrial ?? false}
            trialMinutes={profile?.trialMinutes ?? 15}
            maxTrialsPerWeek={profile?.maxTrialsPerWeek ?? 5}
          />
        </StepShell>
      );
    }

    case 'availability': {
      const [rules, profile, exceptions] = await Promise.all([
        db
          .select({
            weekdayLocal: availabilityRules.weekdayLocal,
            startTimeLocal: availabilityRules.startTimeLocal,
            endTimeLocal: availabilityRules.endTimeLocal,
          })
          .from(availabilityRules)
          .where(eq(availabilityRules.tutorId, user.id))
          .orderBy(asc(availabilityRules.weekdayLocal)),
        db
          .select({ bufferMinutes: tutorProfiles.bufferMinutes })
          .from(tutorProfiles)
          .where(eq(tutorProfiles.userId, user.id))
          .limit(1)
          .then((rows) => rows[0]),
        db
          .select({
            id: availabilityExceptions.id,
            kind: availabilityExceptions.kind,
            startUtc: availabilityExceptions.startUtc,
            endUtc: availabilityExceptions.endUtc,
            note: availabilityExceptions.note,
          })
          .from(availabilityExceptions)
          .where(eq(availabilityExceptions.tutorId, user.id))
          .orderBy(asc(availabilityExceptions.startUtc)),
      ]);

      return (
        <StepShell {...shell}>
          <AvailabilityStep
            timezone={snapshot.timezone ?? 'UTC'}
            bufferMinutes={profile?.bufferMinutes ?? 10}
            rules={rules}
            exceptions={exceptions}
          />
        </StepShell>
      );
    }

    case 'payout': {
      const [method] = await db
        .select({
          accountTitle: payoutMethods.accountTitle,
          bankName: payoutMethods.bankName,
          country: payoutMethods.country,
          last4: payoutMethods.last4,
        })
        .from(payoutMethods)
        .where(eq(payoutMethods.tutorId, user.id))
        .limit(1);

      return (
        <StepShell {...shell}>
          <PayoutStep method={method ?? null} country={snapshot.country} />
        </StepShell>
      );
    }

    case 'review': {
      const [profile] = await db
        .select({ rejectionReason: tutorProfiles.rejectionReason })
        .from(tutorProfiles)
        .where(eq(tutorProfiles.userId, user.id))
        .limit(1);

      return (
        <StepShell {...shell} footer={<span />}>
          <ReviewStep
            progress={wizardProgress(snapshot)}
            status={snapshot.status}
            rejectionReason={profile?.rejectionReason ?? null}
          />
        </StepShell>
      );
    }
  }
}
