/**
 * The password policy, with nothing else attached (SPEC.md §1).
 *
 * Split out from `password.ts` because that file imports bcrypt, and the signup
 * and invite forms are client components: importing the rule from there would
 * drag a hashing library into the browser bundle to render one sentence.
 *
 * The point of the split is that the sentence and the check live together. The
 * invite page once said "at least 10 characters" and then rejected a password
 * that was exactly that, because the real rule also wants a number — the kind of
 * contradiction that makes somebody abandon a signup and never say why.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** The rule, in the words a form should use. */
export const PASSWORD_RULE = `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`;

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
