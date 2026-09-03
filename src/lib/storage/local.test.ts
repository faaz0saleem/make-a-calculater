import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectKeyError } from './keys';
import { LocalObjectStore } from './local';

let root: string;
let store: LocalObjectStore;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tutorly-local-store-'));
  store = new LocalObjectStore(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

describe('LocalObjectStore', () => {
  it('round-trips an object with its content type', async () => {
    await store.put('private', 'credentials/t1/a.pdf', BYTES, 'application/pdf');
    const object = await store.get('private', 'credentials/t1/a.pdf');
    expect(object?.body).toEqual(BYTES);
    expect(object?.contentType).toBe('application/pdf');
    expect(object?.size).toBe(5);
  });

  it('returns null for a key that was never written', async () => {
    expect(await store.get('private', 'credentials/t1/missing.pdf')).toBeNull();
  });

  it('keeps the two buckets apart', async () => {
    await store.put('public', 'avatars/t1/a.jpg', BYTES, 'image/jpeg');
    expect(await store.get('private', 'avatars/t1/a.jpg')).toBeNull();
    expect(await store.get('public', 'avatars/t1/a.jpg')).not.toBeNull();
  });

  it('writes inside the bucket directory', async () => {
    await store.put('private', 'credentials/t2/b.pdf', BYTES, 'application/pdf');
    expect(await readFile(join(root, 'private', 'credentials', 't2', 'b.pdf'))).toEqual(Buffer.from(BYTES));
  });

  it('deletes an object and its sidecar', async () => {
    await store.put('private', 'credentials/t3/c.pdf', BYTES, 'application/pdf');
    await store.delete('private', 'credentials/t3/c.pdf');
    expect(await store.get('private', 'credentials/t3/c.pdf')).toBeNull();
  });

  it('is a no-op when deleting something that is not there', async () => {
    await expect(store.delete('private', 'credentials/t3/gone.pdf')).resolves.toBeUndefined();
  });

  it('refuses a key that tries to escape the bucket', async () => {
    await expect(store.put('private', '../escaped.pdf', BYTES, 'application/pdf')).rejects.toThrow(
      ObjectKeyError,
    );
    await expect(store.get('private', 'credentials/../../etc/passwd')).rejects.toThrow(ObjectKeyError);
  });
});
