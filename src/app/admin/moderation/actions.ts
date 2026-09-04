'use server';

/**
 * Admin moderation actions (SPEC.md §9, §10).
 *
 * Hiding a review is a judgement about somebody's livelihood, so it takes a
 * reason and writes an `admin_audit` row. `hideReview` refuses an empty one.
 */

import { revalidatePath } from 'next/cache';

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
