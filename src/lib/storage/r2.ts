/**
 * Cloudflare R2 through the S3 API (SPEC.md §14).
 *
 * R2 is S3-compatible, so this is the AWS SDK pointed at an R2 endpoint with
 * `region: 'auto'`. Two buckets are configured: the private one holds credential
 * documents and must have public access turned off in the Cloudflare dashboard.
 *
 * Reads are proxied through our own `/api/files` route rather than handed out as
 * presigned S3 URLs. That costs a hop, and buys two things: the bucket hostname
 * never reaches a browser, and the same route can re-check that the viewer is
 * still an admin at the moment they open the file, which a presigned URL cannot.
 */

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { assertValidObjectKey, type Bucket } from './keys';
import { StorageError, type ObjectStore, type StoredObject } from './types';

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  privateBucket: string;
  publicBucket: string;
};

export class R2ObjectStore implements ObjectStore {
  readonly name = 'r2';
  private readonly client: S3Client;
  private readonly buckets: Record<Bucket, string>;

  constructor(config: R2Config) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.buckets = { private: config.privateBucket, public: config.publicBucket };
  }

  /** Exposed so uploads can be presigned against the same client and bucket. */
  clientFor(): S3Client {
    return this.client;
  }

  bucketName(bucket: Bucket): string {
    return this.buckets[bucket];
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertValidObjectKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(bucket: Bucket, key: string): Promise<StoredObject | null> {
    assertValidObjectKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
      );
      if (!result.Body) return null;

      const body = await result.Body.transformToByteArray();
      return {
        body,
        contentType: result.ContentType ?? 'application/octet-stream',
        size: body.byteLength,
      };
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw new StorageError(`could not read ${bucket}/${key} from R2`, { cause: error });
    }
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    assertValidObjectKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.buckets[bucket], Key: key }));
  }
}
