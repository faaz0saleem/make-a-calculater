/**
 * Serving private objects — credential documents (SPEC.md §3 step 6, §13.5).
 *
 * Two independent gates, and a request has to clear both:
 *
 *  1. A valid, unexpired signature over the exact key. Anything missing,
 *     tampered with or older than 60 seconds is a 403. This is what stops a
 *     leaked or guessed path from being useful.
 *  2. The viewer is an admin, or the tutor the document belongs to. Failing this
 *     is a 404, not a 403, so nobody can use the endpoint to discover that a
 *     document exists (SPEC.md §16, last line).
 *
 * A presigned R2 URL could do the first but not the second — it stays valid
 * even if the admin's access is revoked a second later.
 */

import { and, eq } from 'drizzle-orm';

import { currentUser } from '@/lib/auth/guards';
import { db } from '@/db/client';
import { credentials } from '@/db/schema';
import { isAdmin } from '@/lib/auth/roles';
import { bucketForKey, getObjectStore, verifyObjectSignature } from '@/lib/storage';

export const dynamic = 'force-dynamic';

function forbidden(): Response {
  return new Response('Forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
}

function missing(): Response {
  return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await context.params;
  const key = segments.map(decodeURIComponent).join('/');

  const url = new URL(request.url);
  const check = verifyObjectSignature(key, url.searchParams.get('exp'), url.searchParams.get('sig'));
  if (!check.ok) return forbidden();

  // Only the private bucket is served here; public assets have their own route.
  if (bucketForKey(key) !== 'private') return missing();

  const viewer = await currentUser();
  if (!viewer) return missing();

  const [document] = await db
    .select({ id: credentials.id, tutorId: credentials.tutorId })
    .from(credentials)
    .where(eq(credentials.fileKey, key))
    .limit(1);

  if (!document) return missing();
  if (!isAdmin(viewer.roles) && document.tutorId !== viewer.id) return missing();

  const object = await getObjectStore().get('private', key);
  if (!object) return missing();

  return new Response(Buffer.from(object.body), {
    status: 200,
    headers: {
      'content-type': object.contentType,
      'content-length': String(object.size),
      // Rendered inline in the review screen; never offered as a download.
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // A credential document should never be framed by another origin.
      'content-security-policy': "default-src 'none'; img-src 'self'; object-src 'self'; frame-ancestors 'self'",
    },
  });
}

/** Unused verbs are refused explicitly rather than falling through to a 405 page. */
export async function POST() {
  return forbidden();
}
