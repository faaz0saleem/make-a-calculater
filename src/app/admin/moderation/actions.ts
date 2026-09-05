'use server';

/**
 * Admin moderation actions (SPEC.md §9, §10).
 *
 * Hiding a review is a judgement about somebody's livelihood, so it takes a
 * reason and writes an `admin_audit` row. `hideReview` refuses an empty one.
 */

import { revalidatePath } from 'next/cache';

import { resolveDispute, type DisputeDecision } from '@/db/disputes';
import { hideReview, unhideReview } from '@/db/reviews';
import { requireRole } from '@/lib/auth/guards';
import { requestIp } from '@/lib/admin/audit';

export async function hideReviewAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const reviewId = String(formData.get('reviewId') ?? '');
  const reason = String(formData.get('reason') ?? '');

  if (reviewId && reason.trim()) {
    await hideReview(reviewId, { id: admin.id, ip: await requestIp() }, reason);
  }

  revalidatePath('/admin/moderation');
}

export async function unhideReviewAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const reviewId = String(formData.get('reviewId') ?? '');
  const reason = String(formData.get('reason') ?? 'restored');

  if (reviewId) {
    await unhideReview(reviewId, { id: admin.id, ip: await requestIp() }, reason);
  }

  revalidatePath('/admin/moderation');
}

/**
 * Resolve a disputed session.
 *
 * `settle` runs the ordinary settlement — whatever the attendance says. `refund`
 * overrides it and returns the student's credits. Either way it writes an
 * `admin_audit` row with the reason, because this moves money.
 */
export async function resolveDisputeAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const reportId = String(formData.get('reportId') ?? '');
  const decision = String(formData.get('decision') ?? '') === 'refund' ? 'refund' : 'settle';
  const reason = String(formData.get('reason') ?? '');

  if (reportId && reason.trim()) {
    await resolveDispute({
      reportId,
      admin: { id: admin.id, ip: await requestIp() },
      decision: decision as DisputeDecision,
      reason,
    });
  }

  revalidatePath('/admin/moderation');
  revalidatePath('/admin');
}
