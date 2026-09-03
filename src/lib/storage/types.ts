/**
 * The storage interface (SPEC.md §14: Cloudflare R2, S3 API).
 *
 * Two buckets. `private` holds credential documents and is never publicly
 * readable — every read goes through a 60-second signed URL. `public` holds
 * avatars and intro videos.
 *
 * Two backends implement this: the local filesystem for development, and R2 in
 * production. Nothing above this interface knows which one it is talking to.
 */

import type { Bucket } from './keys';

export type StoredObject = {
  body: Uint8Array;
  contentType: string;
  size: number;
};

export interface ObjectStore {
  readonly name: string;
  put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(bucket: Bucket, key: string): Promise<StoredObject | null>;
  delete(bucket: Bucket, key: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}
