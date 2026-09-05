'use server';

/**
 * Working the reports queue (SPEC.md §8, §10).
 *
 * Every action here demands a reason before it will do anything, and the reason
 * is what the person on the other end reads. That is not ceremony: a resolution
 * with no explanation is indistinguishable from nobody having looked.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { decideAppeal, decideContactFlag, resolveReport } from '@/db/reports';
import { requestIp } from '@/lib/admin/audit';
import { requireRole } from '@/lib/auth/guards';
import type { ReportAction } from '@/lib/moderation/reports';
import { SANCTION_LEVELS, type SanctionLevel } from '@/lib/moderation/sanctions';

function back(message: string, kind: 'error' | 'done'): never {
  redirect(`/admin/reports?${kind}=${encodeURIComponent(message)}`);
}

function done(): never {
  revalidatePath('/admin/reports');
  revalidatePath('/admin');
  back('Recorded.', 'done');
}

export async function resolveReportAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const reportId = String(formData.get('reportId') ?? '');
  const action = String(formData.get('action') ?? '') as ReportAction;
  const reason = String(formData.get('reason') ?? '').trim();
  const subjectId = String(formData.get('subjectId') ?? '') || null;

  if (!reportId) back('That report could not be found.', 'error');
  if (!reason) back('Every resolution needs a reason. The people involved read it.', 'error');

  const result = await resolveReport(
    { reportId, action, reason, subjectId },
    { id: admin.id, ip: await requestIp() },
  );

  if (!result.ok) back(result.reason ?? 'That did not work.', 'error');
  done();
}

/**
 * Confirm or dismiss a contact-info flag.
 *
 * Dismissing takes no reason on purpose. Making it as cheap as possible to say
 * "this was a false positive" is what keeps the queue honest — a reviewer who
 * has to justify every dismissal starts confirming instead.
 */
export async function decideContactFlagAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const flagId = String(formData.get('flagId') ?? '');
  const verdict = String(formData.get('verdict') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const rawLevel = String(formData.get('level') ?? '');

  if (!flagId) back('That flag could not be found.', 'error');

  const confirm = verdict === 'confirm';
  const level: SanctionLevel | null =
    confirm && SANCTION_LEVELS.includes(rawLevel as SanctionLevel) ? (rawLevel as SanctionLevel) : null;

  if (confirm && level && !reason) {
    back('A warning or a restriction needs a reason. The person reads it word for word.', 'error');
  }

  const result = await decideContactFlag(
    { flagId, confirm, level, reason },
    { id: admin.id, ip: await requestIp() },
  );

  if (!result.ok) back(result.reason ?? 'That did not work.', 'error');
  done();
}

export async function decideAppealAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');
  const sanctionId = String(formData.get('sanctionId') ?? '');
  const uphold = String(formData.get('uphold') ?? '') === 'yes';
  const outcome = String(formData.get('outcome') ?? '').trim();

  if (!sanctionId) back('That notice could not be found.', 'error');
  if (!outcome) back('Say why. They read this.', 'error');

  const result = await decideAppeal(
    sanctionId,
    { id: admin.id, ip: await requestIp() },
    { uphold, outcome },
  );

  revalidatePath('/settings/notices');

  if (!result.ok) back(result.reason ?? 'That did not work.', 'error');
  done();
}
