/**
 * The development stand-in for a presigned bucket upload.
 *
 * With R2 configured, browsers PUT straight to Cloudflare and never reach this.
 * Without it, this route is what a signed upload URL points at. It is a Route
 * Handler rather than a Server Action precisely because a Route Handler can
 * take a body larger than 1 MB.
 *
 * The signature is scoped to `put` and to one exact key, so a URL that lets an
 * admin read a credential cannot be reused to overwrite one, and an upload URL
 * cannot be pointed at a different object.
 */

import { bucketForKey, getObjectStore, verifyObjectSignature } from '@/lib/storage';
import { UPLOAD_RULES } from '@/lib/storage/uploads';
import { currentUser } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/** Nothing we accept is larger than the video cap. */
const MAX_BYTES = UPLOAD_RULES.introVideo.maxBytes;

export async function PUT(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await context.params;
  const key = segments.map(decodeURIComponent).join('/');

  const url = new URL(request.url);
  const check = verifyObjectSignature(
    key,
    url.searchParams.get('exp'),
    url.searchParams.get('sig'),
    Date.now(),
    'put',
  );
  if (!check.ok) {
    return new Response('Forbidden', { status: 403 });
  }

  // The signature already binds the key to whoever asked for it, but a signed
  // URL should still not work for a signed-out caller who found it in a log.
  if (!(await currentUser())) {
    return new Response('Not found', { status: 404 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0) {
    return new Response('Empty body', { status: 400 });
  }
  if (body.byteLength > MAX_BYTES) {
    return new Response('Too large', { status: 413 });
  }

  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  await getObjectStore().put(bucketForKey(key), key, body, contentType);

  return Response.json({ ok: true, key });
}
