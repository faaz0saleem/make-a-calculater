/**
 * Filesystem-backed object store, for development and tests.
 *
 * Writes under `LOCAL_STORAGE_DIR` (default `.storage/`, gitignored), one
 * directory per bucket. Content types are kept in a sidecar `.meta` file so a
 * round trip returns the same type it was given, exactly as S3 would.
 *
 * Keys are validated before they touch the filesystem, so a key cannot walk out
 * of its bucket directory.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { assertValidObjectKey, type Bucket } from './keys';
import { StorageError, type ObjectStore, type StoredObject } from './types';

export class LocalObjectStore implements ObjectStore {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(bucket: Bucket, key: string): string {
    assertValidObjectKey(key);

    const bucketRoot = join(this.root, bucket);
    const target = resolve(join(bucketRoot, key));

    // Belt and braces: the key pattern already forbids traversal, but a resolved
    // path that escapes the bucket is a bug worth failing loudly on.
    if (target !== bucketRoot && !target.startsWith(bucketRoot + sep)) {
      throw new StorageError(`key "${key}" resolves outside its bucket`);
    }
    return target;
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void> {
    const path = this.pathFor(bucket, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(`${path}.meta`, contentType, 'utf8');
  }

  async get(bucket: Bucket, key: string): Promise<StoredObject | null> {
    const path = this.pathFor(bucket, key);
    try {
      const body = await readFile(path);
      const contentType = await readFile(`${path}.meta`, 'utf8').catch(() => 'application/octet-stream');
      return { body: new Uint8Array(body), contentType: contentType.trim(), size: body.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new StorageError(`could not read ${bucket}/${key}`, { cause: error });
    }
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    const path = this.pathFor(bucket, key);
    await rm(path, { force: true });
    await rm(`${path}.meta`, { force: true });
  }
}
