/**
 * Message limits (SPEC.md §8).
 *
 * Their own module because the composer runs in the browser: importing them
 * from `src/db/messages.ts` would drag the Postgres client into the client
 * bundle, and the build says so.
 */

/** Attachments are homework, not a media library. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_MESSAGE_CHARS = 4_000;
