/**
 * Password hashing and the password policy.
 *
 * bcrypt with a cost of 12. Verification is always run — even for an email that
 * does not exist — against a dummy hash, so response timing does not tell an
 * attacker which addresses are registered.
 */

import bcrypt from 'bcryptjs';

// The policy itself lives in a bcrypt-free module so client components can
// render the rule without pulling a hashing library into the browser.
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULE,
  passwordProblem,
} from './password-rules';

import { passwordProblem as checkPassword } from './password-rules';

const COST = 12;

/** A real bcrypt hash of a value nobody can guess, used to burn time on misses. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3zC5eF0h/OFbT4rqRJ1i0z2eKQ7l0Aq';

export async function hashPassword(password: string): Promise<string> {
  const problem = checkPassword(password);
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
