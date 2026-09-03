/**
 * Picking a backend and building URLs.
 *
 * R2 when it is configured, the local filesystem otherwise. The choice is made
 * once per process; nothing above this module knows which one it got.
 */

import { LocalObjectStore } from './local';
import { R2ObjectStore } from './r2';
import { bucketForKey, type Bucket } from './keys';
import { signObjectPath, SIGNED_URL_TTL_SECONDS } from './signed-url';
import type { ObjectStore } from './types';

export * from './keys';
export * from './signed-url';
export type { ObjectStore, StoredObject } from './types';
export { StorageError } from './types';

function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_PRIVATE_BUCKET &&
      process.env.R2_PUBLIC_BUCKET,
  );
}

let cached: ObjectStore | null = null;

export function getObjectStore(): ObjectStore {
  if (cached) return cached;

  cached = isR2Configured()
    ? new R2ObjectStore({
        accountId: process.env.R2_ACCOUNT_ID!,
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        privateBucket: process.env.R2_PRIVATE_BUCKET!,
        publicBucket: process.env.R2_PUBLIC_BUCKET!,
      })
    : new LocalObjectStore(process.env.LOCAL_STORAGE_DIR ?? '.storage');

  return cached;
}

/** Only for tests. */
export function resetObjectStore(): void {
  cached = null;
}

/**
 * A URL for an object.
 *
 * Private objects get a signed, short-lived path through our own route. Public
 * objects get the CDN URL when one is configured, and otherwise the dev route
 * that reads straight out of the local store.
 */
export function objectUrl(key: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): string {
  const bucket: Bucket = bucketForKey(key);

  if (bucket === 'private') {
    return signObjectPath(key, ttlSeconds);
  }

  const base = process.env.R2_PUBLIC_BASE_URL;
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return base ? `${base.replace(/\/$/, '')}/${encoded}` : `/api/public-files/${encoded}`;
}
