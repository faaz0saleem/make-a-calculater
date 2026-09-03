'use server';

/**
 * Admin decisions on a tutor profile (SPEC.md §10).
 *
 * Both actions are admin-only, both go through the tutor status machine, and
 * both write an `admin_audit` row inside the same transaction as the decision.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/auth/guards';
import { requestIp } from '@/lib/admin/audit';
import {
  approveTutor,
  rejectTutor,
  VerificationError,
  type VerificationChecklist,
} from '@/lib/tutors/verification';

function back(tutorId: string, error: string): never {
  redirect(`/admin/verification/${tutorId}?error=${encodeURIComponent(error)}`);
}

export async function approveTutorAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const tutorId = String(formData.get('tutorId') ?? '');
  if (!tutorId) back(tutorId, 'Missing tutor.');

  const checklist: VerificationChecklist = {
    nameMatchesDocument: formData.get('nameMatchesDocument') === 'on',
    institutionPlausible: formData.get('institutionPlausible') === 'on',
    documentLegible: formData.get('documentLegible') === 'on',
    notExpired: formData.get('notExpired') === 'on',
  };

  try {
    await approveTutor({
      tutorId,
      adminId: admin.id,
      checklist,
      note: String(formData.get('note') ?? '').trim() || null,
      ip: await requestIp(),
    });
  } catch (error) {
    back(tutorId, error instanceof VerificationError ? error.message : 'Could not approve. Try again.');
  }

  revalidatePath('/admin/verification');
  revalidatePath('/');
  redirect('/admin/verification?decided=approved');
}

export async function rejectTutorAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const tutorId = String(formData.get('tutorId') ?? '');
  if (!tutorId) back(tutorId, 'Missing tutor.');

  try {
    await rejectTutor({
      tutorId,
      adminId: admin.id,
      reason: String(formData.get('reason') ?? ''),
      ip: await requestIp(),
    });
  } catch (error) {
    back(tutorId, error instanceof VerificationError ? error.message : 'Could not reject. Try again.');
  }

  revalidatePath('/admin/verification');
  redirect('/admin/verification?decided=rejected');
}
