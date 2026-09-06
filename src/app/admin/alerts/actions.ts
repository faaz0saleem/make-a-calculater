'use server';

/**
 * Putting a dead letter back in the queue (SPEC.md §11).
 *
 * Deliberately the only action on the alerts page. Everything else there is a
 * link to the screen that owns the decision — an alerts view that grows its own
 * buttons becomes a second place where money moves.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { retryDeadLetter } from '@/db/email';
import { requestIp, writeAudit } from '@/lib/admin/audit';
import { requireRole } from '@/lib/auth/guards';
import { db } from '@/db/client';

export async function retryDeadLetterAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/admin/alerts');

  const requeued = await retryDeadLetter(id);

  if (requeued) {
    await writeAudit(db, {
      actorId: admin.id,
      action: 'email.retry',
      targetType: 'email_delivery',
      targetId: id,
      before: { status: 'dead' },
      after: { status: 'queued' },
      reason: null,
      ip: await requestIp(),
    });
  }

  revalidatePath('/admin/alerts');
  redirect('/admin/alerts?done=requeued');
}
