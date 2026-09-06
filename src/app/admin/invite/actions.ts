'use server';

/**
 * Creating and withdrawing tutor invites (SPEC.md §3, §14).
 *
 * Both write an `admin_audit` row. Handing somebody a pre-verified profile is a
 * trust decision, and a trust decision with no record of who made it is the
 * kind of thing that is impossible to explain a year later.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { createTutorInvite, revokeInvite } from '@/db/invites';
import { requestIp, writeAudit } from '@/lib/admin/audit';
import { requireRole } from '@/lib/auth/guards';

export async function inviteTutorAction(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');

  const result = await createTutorInvite({
    email: String(formData.get('email') ?? ''),
    name: String(formData.get('name') ?? ''),
    note: String(formData.get('note') ?? ''),
    adminId: admin.id,
  });

  if (!result.ok) {
    redirect(`/admin/invite?error=${encodeURIComponent(result.reason)}`);
  }

  await writeAudit(db, {
    actorId: admin.id,
    action: 'tutor.invite',
    targetType: 'tutor_invite',
    targetId: result.invite.id,
    before: null,
    after: { email: String(formData.get('email') ?? '').trim().toLowerCase(), preVerified: true },
    reason: String(formData.get('note') ?? '').trim() || null,
    ip: await requestIp(),
  });

  revalidatePath('/admin/invite');
  // The token travels in the URL exactly once, so the page can show the link to
  // copy. It is not stored anywhere in plaintext, including here.
  redirect(`/admin/invite?created=${result.invite.id}&token=${encodeURIComponent(result.invite.token)}`);
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  await requireRole('admin');
  const id = String(formData.get('id') ?? '');

  if (id) await revokeInvite(id);

  revalidatePath('/admin/invite');
  redirect('/admin/invite?done=revoked');
}
