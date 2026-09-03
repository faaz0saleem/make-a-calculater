/**
 * Object keys.
 *
 * A key is the path of an object inside a bucket. Keys are built here and
 * nowhere else, and every key that reaches a store is validated first — a key
 * containing `..` or a leading slash would let a crafted value escape the
 * directory the local backend writes into.
 */

export type Bucket = 'private' | 'public';

/** Lowercase letters, digits, dash, underscore, dot and slash. No `..`, no leading slash. */
const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$/;

export class ObjectKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectKeyError';
  }
}

export function isValidObjectKey(key: string): boolean {
  if (!KEY_PATTERN.test(key)) return false;
  if (key.includes('..')) return false;
  if (key.includes('//')) return false;
  return true;
}

export function assertValidObjectKey(key: string): string {
  if (!isValidObjectKey(key)) {
    throw new ObjectKeyError(`"${key}" is not a valid object key`);
  }
  return key;
}

/** Credential documents. Private bucket, admin-only, 60-second signed URLs. */
export function credentialKey(tutorId: string, credentialId: string, extension: string): string {
  return assertValidObjectKey(`credentials/${tutorId}/${credentialId}.${normaliseExtension(extension)}`);
}

/** Profile photos. Public bucket. */
export function avatarKey(userId: string, assetId: string, extension: string): string {
  return assertValidObjectKey(`avatars/${userId}/${assetId}.${normaliseExtension(extension)}`);
}

/** Intro videos. Public bucket. Phase 2 replaces the raw file with an HLS ladder. */
export function introVideoKey(userId: string, videoId: string, extension: string): string {
  return assertValidObjectKey(`videos/${userId}/${videoId}.${normaliseExtension(extension)}`);
}

function normaliseExtension(extension: string): string {
  const cleaned = extension.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(cleaned)) {
    throw new ObjectKeyError(`"${extension}" is not a usable file extension`);
  }
  return cleaned;
}

/** Which bucket a key belongs in, decided by its prefix. */
export function bucketForKey(key: string): Bucket {
  return key.startsWith('credentials/') ? 'private' : 'public';
}
