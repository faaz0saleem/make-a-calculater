/**
 * The things a student tells us after signing up.
 *
 * Signup asks for an email, a password and whether they are 18 or over, and
 * nothing else. The rest arrives at the moment it pays them back:
 *
 *  - their **class**, from a prompt on the feed, because knowing it makes the
 *    feed better immediately
 *  - their **name**, on the booking form, because the tutor is about to need it
 *  - their **phone**, at the reminder step, framed as WhatsApp reminders,
 *    because a reminder is a thing they want rather than a tax we charge
 *  - a **guardian's email**, at a first booking by somebody under 18, because
 *    that is the moment it stops being a hypothetical
 *
 * Every function here is scoped to a user id resolved from the session by the
 * caller. None of them take a role, and none of them can be used to write
 * somebody else's row.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { db as defaultDb } from './client';
import type { DbLike } from './ledger';
import { users } from './schema';

export type StudentProfile = {
  name: string;
  nameConfirmed: boolean;
  isAdult: boolean | null;
  guardianEmail: string | null;
  guardianLinked: boolean;
  phone: string | null;
  country: string | null;
  timezone: string;
};

export async function loadStudentProfile(
  userId: string,
  database: DbLike = defaultDb,
): Promise<StudentProfile | null> {
  const [row] = await database
    .select({
      name: users.name,
      nameConfirmedAt: users.nameConfirmedAt,
      isAdult: users.isAdult,
      guardianEmail: users.guardianEmail,
      guardianLinkedAt: users.guardianLinkedAt,
      phone: users.phone,
      country: users.country,
      timezone: users.timezone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  return {
    name: row.name,
    nameConfirmed: row.nameConfirmedAt !== null,
    isAdult: row.isAdult,
    guardianEmail: row.guardianEmail,
    guardianLinked: row.guardianLinkedAt !== null,
    phone: row.phone,
    country: row.country,
    timezone: row.timezone,
  };
}

/**
 * The name a tutor will see, given on the booking form.
 *
 * Stamping `name_confirmed_at` is what turns the placeholder derived from their
 * email into a name they chose. Once confirmed the booking form stops asking.
 */
export async function confirmStudentName(
  userId: string,
  name: string,
  database: DbLike = defaultDb,
): Promise<void> {
  const trimmed = name.trim().slice(0, 120);
  if (trimmed.length < 2) return;

  await database
    .update(users)
    .set({ name: trimmed, nameConfirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Record the parent or guardian behind an under-18 account.
 *
 * The email lands now; the `guardian_id` link waits for parent accounts to
 * exist. `guardian_linked_at` is the fact that matters either way — it is what
 * a support conversation, and eventually a regulator, will ask about.
 *
 * Only ever set on an account that has actually said it is under 18. An adult
 * volunteering a parent's address is not something to store.
 */
export async function linkGuardian(
  userId: string,
  guardianEmail: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const email = guardianEmail.trim().toLowerCase().slice(0, 255);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;

  const rows = await database
    .update(users)
    .set({ guardianEmail: email, guardianLinkedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.isAdult, false)))
    .returning({ id: users.id });

  return rows.length > 0;
}

/**
 * Whether this account still owes us a guardian before it can book.
 *
 * True only for somebody who told us they are under 18 and has not yet given a
 * guardian's email. An account that never answered the age question is not
 * blocked — we ask, we do not assume.
 */
export async function needsGuardian(
  userId: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const [row] = await database
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isAdult, false), isNull(users.guardianLinkedAt)))
    .limit(1);

  return Boolean(row);
}

/** A phone number for WhatsApp reminders. Optional, and never a gate. */
export async function saveStudentPhone(
  userId: string,
  phone: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const trimmed = phone.trim();

  if (trimmed === '') {
    await database.update(users).set({ phone: null }).where(eq(users.id, userId));
    return true;
  }

  // Loose on purpose. Numbers here are written +92 300 1234567, 0300-1234567
  // and every variation between; rejecting a real number because of a space is
  // a worse failure than storing one we have to normalise later.
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return false;

  await database
    .update(users)
    .set({ phone: trimmed.slice(0, 32), updatedAt: new Date() })
    .where(eq(users.id, userId));

  return true;
}

/** Correct the country or timezone we inferred from the browser. */
export async function correctInferredPlace(
  userId: string,
  place: { country?: string | null; timezone?: string | null },
  database: DbLike = defaultDb,
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (place.country !== undefined) {
    patch.country = place.country ? place.country.toUpperCase().slice(0, 2) : null;
  }
  if (place.timezone) patch.timezone = place.timezone;

  await database.update(users).set(patch).where(eq(users.id, userId));
}
