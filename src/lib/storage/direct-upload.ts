/**
 * Direct uploads (SPEC.md §3 step 4, §14).
 *
 * An intro video is tens of megabytes. It cannot travel through a Server
 * Action — Next caps those bodies at 1 MB, and a Vercel function caps any
 * request body at 4.5 MB — so a browser that POSTs a video to us fails, and
 * raising a config value would not change that.
 *
 * So the browser uploads straight to the bucket and only tells the server the
 * key afterwards. With R2 that is a presigned S3 PUT. Without R2 there is
 * nothing to presign, so a signed path to our own upload route stands in; a
 * Route Handler streams its body and is not subject to the Server Action limit.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { assertValidObjectKey, type Bucket } from './keys';
import { getObjectStore } from './index';
import { R2ObjectStore } from './r2';
import { signUploadPath, UPLOAD_URL_TTL_SECONDS } from './signed-url';

export type UploadTarget = {
  /** Where the browser PUTs the bytes. */
  url: string;
  /** The key to hand back to the server once the upload finishes. */
  key: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
};

export async function createUploadTarget(
  bucket: Bucket,
  key: string,
  contentType: string,
): Promise<UploadTarget> {
  assertValidObjectKey(key);

  const store = getObjectStore();

  if (store instanceof R2ObjectStore) {
    const url = await getSignedUrl(
      store.clientFor(),
      new PutObjectCommand({ Bucket: store.bucketName(bucket), Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return { url, key, headers: { 'content-type': contentType }, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  return {
    url: signUploadPath(key),
    key,
    headers: { 'content-type': contentType },
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  };
}
