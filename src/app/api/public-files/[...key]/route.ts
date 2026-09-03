/**
 * Serving public objects — avatars and intro videos — in development.
 *
 * In production `R2_PUBLIC_BASE_URL` is set and `objectUrl` returns a CDN URL,
 * so this route is never hit. It exists so the app works with no bucket at all.
 *
 * It refuses anything in the private bucket, which is the only rule that
 * actually matters here.
 */

import { bucketForKey, getObjectStore } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await context.params;
  const key = segments.map(decodeURIComponent).join('/');

  if (bucketForKey(key) !== 'public') {
    return new Response('Not found', { status: 404 });
  }

  const object = await getObjectStore().get('public', key);
  if (!object) return new Response('Not found', { status: 404 });

  return new Response(Buffer.from(object.body), {
    status: 200,
    headers: {
      'content-type': object.contentType,
      'content-length': String(object.size),
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
