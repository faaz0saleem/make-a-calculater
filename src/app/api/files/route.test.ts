/**
 * The private-file route, end to end at the handler level.
 *
 * This is the test that proves the requirement: an unsigned URL is refused with
 * 403, and so is one that is tampered with or out of date. The store is real —
 * a `LocalObjectStore` over a temporary directory — so a 200 means bytes
 * actually came back off disk.
 *
 * Auth and the database are the two things stubbed, because this test is about
 * the route's own rules, not about Postgres.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TUTOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TUTOR_ID = '33333333-3333-4333-8333-333333333333';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';
const KEY = `credentials/${TUTOR_ID}/${CREDENTIAL_ID}.pdf`;
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]); // "%PDF-1.7\n"

/** Rows the stubbed `credentials` lookup returns. Reassigned per test. */
let credentialRows: { id: string; tutorId: string }[] = [];

/** Who the stubbed session says is calling. */
let viewer: { id: string; roles: string[] } | null = null;

vi.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(credentialRows),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/auth/guards', () => ({
  currentUser: () => Promise.resolve(viewer),
}));

let storageRoot: string;
let GET: (request: Request, context: { params: Promise<{ key: string[] }> }) => Promise<Response>;
let signObjectPath: typeof import('@/lib/storage').signObjectPath;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'tutorly-storage-'));

  process.env.DATABASE_URL ??= 'postgres://unused';
  process.env.PAYOUT_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  process.env.AUTH_SECRET = 'route-test-secret-at-least-16-chars';
  process.env.LOCAL_STORAGE_DIR = storageRoot;
  delete process.env.R2_ACCOUNT_ID;

  const storage = await import('@/lib/storage');
  const env = await import('@/lib/env');
  env.resetEnvCache();
  storage.resetObjectStore();
  signObjectPath = storage.signObjectPath;

  await storage.getObjectStore().put('private', KEY, PDF_BYTES, 'application/pdf');

  ({ GET } = await import('@/app/api/files/[...key]/route'));
});

afterAll(async () => {
  await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(() => {
  credentialRows = [{ id: CREDENTIAL_ID, tutorId: TUTOR_ID }];
  viewer = { id: 'admin-1', roles: ['admin'] };
});

/** Calls the handler the way Next would, with the key already split into segments. */
function call(pathAndQuery: string): Promise<Response> {
  const url = new URL(pathAndQuery, 'http://localhost:3000');
  const segments = url.pathname.replace('/api/files/', '').split('/');
  return GET(new Request(url), { params: Promise.resolve({ key: segments }) });
}

describe('an unsigned URL', () => {
  it('is refused with 403', async () => {
    const response = await call(`/api/files/${KEY}`);
    expect(response.status).toBe(403);
  });

  it('is refused even for an admin who is signed in', async () => {
    viewer = { id: 'admin-1', roles: ['admin'] };
    expect((await call(`/api/files/${KEY}`)).status).toBe(403);
  });

  it('is refused even for the tutor the document belongs to', async () => {
    viewer = { id: TUTOR_ID, roles: ['tutor'] };
    expect((await call(`/api/files/${KEY}`)).status).toBe(403);
  });

  it('is refused when only one of the two parameters is present', async () => {
    expect((await call(`/api/files/${KEY}?exp=99999999999`)).status).toBe(403);
    expect((await call(`/api/files/${KEY}?sig=abc`)).status).toBe(403);
  });

  it('does not leak the file through a guessed signature', async () => {
    expect((await call(`/api/files/${KEY}?exp=99999999999&sig=AAAAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(403);
  });
});

describe('a signed URL', () => {
  it('serves the bytes to an admin', async () => {
    const response = await call(signObjectPath(KEY));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('serves the bytes to the tutor who owns the document', async () => {
    viewer = { id: TUTOR_ID, roles: ['tutor'] };
    expect((await call(signObjectPath(KEY))).status).toBe(200);
  });

  it('is refused once it has expired', async () => {
    const stale = signObjectPath(KEY, 60, Date.now() - 61_000);
    expect((await call(stale)).status).toBe(403);
  });

  it('is refused when the signature is altered', async () => {
    const signed = signObjectPath(KEY);
    const tampered = signed.replace(/sig=(.)/, (_match, first: string) => `sig=${first === 'A' ? 'B' : 'A'}`);
    expect((await call(tampered)).status).toBe(403);
  });

  it('cannot be pointed at a different tutor\'s document', async () => {
    const signed = signObjectPath(KEY);
    const otherKey = `credentials/${OTHER_TUTOR_ID}/${CREDENTIAL_ID}.pdf`;
    const swapped = signed.replace(KEY, otherKey);
    expect((await call(swapped)).status).toBe(403);
  });
});

describe('authorization, once the signature is valid', () => {
  it('hides the document from a signed-in stranger with a 404, not a 403', async () => {
    viewer = { id: 'someone-else', roles: ['student'] };
    const response = await call(signObjectPath(KEY));
    expect(response.status).toBe(404);
  });

  it('hides the document from a different tutor', async () => {
    viewer = { id: OTHER_TUTOR_ID, roles: ['tutor'] };
    expect((await call(signObjectPath(KEY))).status).toBe(404);
  });

  it('hides the document from a signed-out visitor', async () => {
    viewer = null;
    expect((await call(signObjectPath(KEY))).status).toBe(404);
  });

  it('404s when no credential row references the key', async () => {
    credentialRows = [];
    expect((await call(signObjectPath(KEY))).status).toBe(404);
  });

  it('404s when the row exists but the object does not', async () => {
    const ghostKey = `credentials/${TUTOR_ID}/99999999-9999-4999-8999-999999999999.pdf`;
    credentialRows = [{ id: 'ghost', tutorId: TUTOR_ID }];
    expect((await call(signObjectPath(ghostKey))).status).toBe(404);
  });
});

describe('bucket separation', () => {
  it('will not serve a public-bucket key through the private route', async () => {
    const publicKey = `avatars/${TUTOR_ID}/photo.jpg`;
    expect((await call(signObjectPath(publicKey))).status).toBe(404);
  });
});

describe('other verbs', () => {
  it('refuses POST', async () => {
    const { POST } = await import('@/app/api/files/[...key]/route');
    expect((await POST()).status).toBe(403);
  });
});
