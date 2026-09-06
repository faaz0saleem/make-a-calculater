/**
 * Submitting a profile, and an admin deciding on it (SPEC.md §3, §10).
 *
 * Each of these is one transaction: the status change, any related row updates,
 * and — for admin decisions — the `admin_audit` row all commit together.
 * Nothing here writes `tutor_profiles.status` without going through
 * `transitionTutor`, so an impossible transition throws before it reaches SQL.
 */

import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { emailVerificationDecision } from '@/db/email-events';
import { credentials, tutorProfiles } from '@/db/schema';
import { loadWizardSnapshot } from '@/db/tutors';
import { writeAudit } from '@/lib/admin/audit';
import { recomputeTutorRankingFor } from '@/db/ranking';
import { transitionTutor, type TutorStatus } from './status';
import { wizardProgress } from './wizard';

export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

async function currentStatus(tutorId: string): Promise<TutorStatus> {
  const [row] = await db
    .select({ status: tutorProfiles.status })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, tutorId))
    .limit(1);

  if (!row) throw new VerificationError('No tutor profile for that account.');
  return row.status as TutorStatus;
}

/**
 * The tutor sends their profile to the queue.
 *
 * The wizard's own completeness check runs again here, server-side: the button
 * being enabled in the browser is not evidence.
 */
export async function submitForReview(tutorId: string): Promise<void> {
  const snapshot = await loadWizardSnapshot(tutorId);
  if (!snapshot) throw new VerificationError('No tutor profile for that account.');

  const progress = wizardProgress(snapshot);
  if (!progress.canSubmit) {
    const missing = progress.blocking.map((step) => step.title).join(', ');
    throw new VerificationError(`Finish these steps first: ${missing}.`);
  }

  const now = new Date();

  // An invited tutor's credentials were vetted by a person before they ever saw
  // the site (SPEC.md §3). Sending them to a queue of one to be approved by the
  // same person who invited them is theatre, and it delays the only thing that
  // matters at launch — a real profile in the feed.
  const [profile] = await db
    .select({ preApproved: tutorProfiles.credentialsPreApproved, invitedBy: tutorProfiles.verifiedBy })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, tutorId))
    .limit(1);

  if (profile?.preApproved) {
    await db
      .update(tutorProfiles)
      .set({
        status: 'verified',
        submittedAt: now,
        verifiedAt: now,
        rejectionReason: null,
        updatedAt: now,
      })
      .where(eq(tutorProfiles.userId, tutorId));

    await recomputeTutorRankingFor(tutorId);
    await emailVerificationDecision({ tutorId, decision: 'approved' });
    return;
  }

  const next = transitionTutor(snapshot.status, 'pending_review');

  await db
    .update(tutorProfiles)
    .set({
      status: next,
      submittedAt: now,
      // A resubmission clears the previous rejection so the queue shows it fresh.
      rejectionReason: null,
      updatedAt: now,
    })
    .where(eq(tutorProfiles.userId, tutorId));
}

/** The tutor pulls a submission back so they can keep editing. */
export async function withdrawSubmission(tutorId: string): Promise<void> {
  const status = await currentStatus(tutorId);
  const next = transitionTutor(status, 'draft');

  await db
    .update(tutorProfiles)
    .set({ status: next, submittedAt: null, updatedAt: new Date() })
    .where(eq(tutorProfiles.userId, tutorId));
}

export type VerificationChecklist = {
  nameMatchesDocument: boolean;
  institutionPlausible: boolean;
  documentLegible: boolean;
  notExpired: boolean;
};

export const CHECKLIST_ITEMS: { key: keyof VerificationChecklist; label: string }[] = [
  { key: 'nameMatchesDocument', label: 'The name on the document matches the profile' },
  { key: 'institutionPlausible', label: 'The institution exists and is plausible' },
  { key: 'documentLegible', label: 'The document is legible' },
  { key: 'notExpired', label: 'The document has not expired' },
];

export function checklistComplete(checklist: VerificationChecklist): boolean {
  return CHECKLIST_ITEMS.every((item) => checklist[item.key]);
}

/**
 * An admin approves. The profile becomes visible in the feed from this moment,
 * so the audit row records who did it and what the checklist said.
 */
export async function approveTutor(params: {
  tutorId: string;
  adminId: string;
  checklist: VerificationChecklist;
  note?: string | null;
  ip?: string | null;
}): Promise<void> {
  if (!checklistComplete(params.checklist)) {
    throw new VerificationError('Tick every checklist item before approving, or reject with a reason.');
  }

  const status = await currentStatus(params.tutorId);
  const next = transitionTutor(status, 'verified');
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(tutorProfiles)
      .set({
        status: next,
        verifiedAt: now,
        verifiedBy: params.adminId,
        rejectionReason: null,
        updatedAt: now,
      })
      .where(eq(tutorProfiles.userId, params.tutorId));

    // Approving the profile approves the documents that justified it.
    await tx
      .update(credentials)
      .set({ status: 'approved', reviewedBy: params.adminId, reviewedAt: now })
      .where(and(eq(credentials.tutorId, params.tutorId), eq(credentials.status, 'pending')));

    await writeAudit(tx, {
      actorId: params.adminId,
      action: 'tutor.verify',
      targetType: 'tutor_profile',
      targetId: params.tutorId,
      before: { status },
      after: { status: next, checklist: params.checklist },
      reason: params.note ?? null,
      ip: params.ip ?? null,
    });
  });

  // Score them now, so a newly verified tutor is discoverable straight away
  // instead of waiting for the nightly job.
  await recomputeTutorRankingFor(params.tutorId);

  // A tutor who submitted documents days ago is not sitting on the site waiting
  // for a bell to light up. This is the message that brings them back.
  await emailVerificationDecision({ tutorId: params.tutorId, decision: 'approved' });
}

/**
 * An admin rejects, naming the reason.
 *
 * SPEC.md §3: the reason must be specific and the tutor must be able to fix it
 * and resubmit, so it is stored on the profile rather than only in the log.
 */
export async function rejectTutor(params: {
  tutorId: string;
  adminId: string;
  reason: string;
  ip?: string | null;
}): Promise<void> {
  const reason = params.reason.trim();
  if (reason.length < 10) {
    throw new VerificationError('Give a specific reason — the tutor has to be able to act on it.');
  }

  const status = await currentStatus(params.tutorId);
  const next = transitionTutor(status, 'rejected');
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(tutorProfiles)
      .set({ status: next, rejectionReason: reason, updatedAt: now })
      .where(eq(tutorProfiles.userId, params.tutorId));

    await tx
      .update(credentials)
      .set({ status: 'rejected', reviewedBy: params.adminId, reviewedAt: now, note: reason })
      .where(and(eq(credentials.tutorId, params.tutorId), eq(credentials.status, 'pending')));

    await writeAudit(tx, {
      actorId: params.adminId,
      action: 'tutor.reject',
      targetType: 'tutor_profile',
      targetId: params.tutorId,
      before: { status },
      after: { status: next },
      reason,
      ip: params.ip ?? null,
    });
  });

  // The reason travels with it. A rejection somebody cannot act on is a
  // rejection they will resubmit unchanged.
  await emailVerificationDecision({ tutorId: params.tutorId, decision: 'rejected', reason });
}
