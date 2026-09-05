/**
 * The prompts a student is shown after signup, and how long "not now" lasts.
 *
 * Cookies rather than columns. A dismissal is a browsing preference: it has to
 * work before the answer exists, it should wear off, and nothing else in the
 * product should depend on it.
 */

/** Set by "Not now" on the feed's class prompt. */
export const CURRICULUM_PROMPT_COOKIE = 'tutorly_class_prompt';

/**
 * How long the class prompt stays away.
 *
 * A fortnight, not for ever. Somebody browsing idly in January may be looking
 * hard in February, and a question worth asking once is worth asking twice.
 * Once they answer it never comes back, because then there is nothing to ask.
 */
export const CURRICULUM_PROMPT_DISMISS_DAYS = 14;
