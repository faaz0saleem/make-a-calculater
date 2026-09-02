/**
 * Password hashing and the password policy.
 *
 * bcrypt with a cost of 12. Verification is always run — even for an email that
 * does not exist — against a dummy hash, so response timing does not tell an
 * attacker which addresses are registered.
 */

import bcrypt from 'bcryptjs';

const COST = 12;

/** A real bcrypt hash of a value nobody can guess, used to burn time on misses. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3zC5eF0h/OFbT4rqRJ1i0z2eKQ7l0Aq';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  return bcrypt.hash(password, COST);
}

/**
 * Verify a password. Pass `null` when the account has no password (Google-only
 * sign-up) or does not exist — the comparison still runs, and still costs the
 * same amount of time.
 */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  const matches = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash === null ? false : matches;
}
