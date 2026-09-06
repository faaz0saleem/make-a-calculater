'use server';

/**
 * Accepting an invitation (SPEC.md §3).
 *
 * Creates the account and the draft tutor profile in one transaction with the
 * invite being marked used, so two people opening the same link cannot both get
 * an account: the `accepted_at is null` guard is inside the same transaction as
 * the insert.
 *
 * `credentialsPreApproved` is stamped on the profile rather than the account.
 * It means one thing only — when this tutor submits their profile, it goes
 * straight to verified instead of into the review queue, because a human
 * already did the vetting in person.
 */

import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { attachInviteUser, claimInvite, inviteByToken } from '@/db/invites';
import { studentWallets, tutorProfiles, users } from '@/db/schema';
import { requestIp, writeAudit } from '@/lib/admin/audit';
import { hashPassword, passwordProblem } from '@/lib/auth/password';
import type { UserRole } from '@/lib/auth/roles';
import { countryFromTimeZone } from '@/lib/geo/timezone-country';
import { deriveHalfHourCents } from '@/lib/money/pricing';
import { logEvent } from '@/lib/observability/log';
import { isValidTimeZone } from '@/lib/time';

export async function acceptInviteAction(token: string, formData: FormData): Promise<void> {
  const back = (message: string) =>
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(message)}`);

  const invite = await inviteByToken(token);
  if (!invite) back('That invitation is no longer valid. Ask for another.');

  const name = String(formData.get('name') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const rawTimezone = String(formData.get('timezone') ?? 'UTC');
  const timezone = isValidTimeZone(rawTimezone) ? rawTimezone : 'UTC';

  if (name.length < 2) back('Tell us your name.');

  const problem = passwordProblem(password);
  if (problem) back(problem);

  // A tutor is paid, signs contracts and teaches minors. The invite does not
  // waive that; it is asked here for the same reason signup asks it.
  if (formData.get('isAdult') !== 'on') {
    back('Tutors have to be 18 or over.');
  }

  const passwordHash = await hashPassword(password);
  const roles: UserRole[] = ['student', 'tutor'];

  const userId = await db.transaction(async (tx) => {
    // Inside the transaction: if the invite was used a moment ago, no account
    // is created rather than an orphan being left behind.
    const claimed = await claimInvite(invite!.id, new Date(), tx);
    if (!claimed) return null;

    const [created] = await tx
      .insert(users)
      .values({
        email: invite!.email,
        passwordHash,
        name,
        nameConfirmedAt: new Date(),
        roles,
        timezone,
        country: countryFromTimeZone(timezone),
        isAdult: true,
      })
      .returning({ id: users.id });

    if (!created) throw new Error('failed to create the invited account');

    await tx.insert(studentWallets).values({ userId: created.id });

    await tx.insert(tutorProfiles).values({
      userId: created.id,
      status: 'draft',
      hourlyCents: 2_500,
      halfHourCents: deriveHalfHourCents(2_500),
      credentialsPreApproved: invite!.preVerified,
    });

    // Point the invite at the account it actually created.
    await attachInviteUser(invite!.id, created.id, tx);

    await writeAudit(tx, {
      actorId: invite!.invitedBy,
      action: 'tutor.invite',
      targetType: 'tutor_profile',
      targetId: created.id,
      before: null,
      after: { acceptedInvite: invite!.id, credentialsPreApproved: invite!.preVerified },
      reason: 'invited tutor accepted',
      ip: await requestIp(),
    });

    return created.id;
  });

  if (!userId) back('That invitation has already been used.');

  logEvent('invite.accepted', { inviteId: invite!.id, userId });
  redirect('/signin?invited=1');
}
