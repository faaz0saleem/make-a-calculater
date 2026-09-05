'use server';

/**
 * Editing what credits cost (SPEC.md §2).
 *
 * Prices live in `credit_packs` so they can change without a deploy. Every
 * change writes an audit row: this decides what students pay.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { creditPacks } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requestIp, writeAudit } from '@/lib/admin/audit';
import { requireRole } from '@/lib/auth/guards';

export async function saveCreditPack(formData: FormData): Promise<void> {
  const admin = await requireRole('admin');

  const id = String(formData.get('packId') ?? '');
  const paidCents = Number(formData.get('paidCents') ?? 0);
  const creditsCents = Number(formData.get('creditsCents') ?? 0);
  const active = String(formData.get('active') ?? '') === 'on';

  const bad =
    !id ||
    !Number.isInteger(paidCents) ||
    !Number.isInteger(creditsCents) ||
    paidCents < 100 ||
    creditsCents < paidCents;

  if (bad) {
    redirect(
      `/admin/packs?error=${encodeURIComponent(
        'A pack costs at least $1, and must give at least as many credits as it costs.',
      )}`,
    );
  }

  const [before] = await db
    .select({
      paidCents: creditPacks.paidCents,
      creditsCents: creditPacks.creditsCents,
      active: creditPacks.active,
    })
    .from(creditPacks)
    .where(eq(creditPacks.id, id))
    .limit(1);

  if (!before) redirect('/admin/packs?error=No+such+pack');

  await db.transaction(async (tx) => {
    await tx
      .update(creditPacks)
      .set({ paidCents, creditsCents, active })
      .where(eq(creditPacks.id, id));

    await writeAudit(tx, {
      actorId: admin.id,
      action: 'pack.update',
      targetType: 'credit_pack',
      targetId: null,
      before,
      after: { paidCents, creditsCents, active, id },
      reason: 'price change',
      ip: await requestIp(),
    });
  });

  revalidatePath('/admin/packs');
  revalidatePath('/credits');
  redirect('/admin/packs?saved=1');
}
