'use server';

/**
 * Handing work in (SPEC.md §9).
 *
 * Attachments travel the same three-step path as message files: straight to
 * the bucket, with only their metadata through the Server Action. A Server
 * Action body caps at 1 MB and a scanned past paper is bigger than that.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { randomUUID } from 'node:crypto';

import { homeworkForViewer, submitHomework } from '@/db/homework';
import { requireUser } from '@/lib/auth/guards';
import { createUploadTarget, objectUrl } from '@/lib/storage';
import { homeworkKey } from '@/lib/storage/keys';
import { UPLOAD_RULES } from '@/lib/storage/uploads';
import type { Attachment } from '@/db/messages';

function readAttachments(raw: unknown): Attachment[] {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? '[]'));
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (entry): entry is Attachment =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Attachment).url === 'string' &&
          typeof (entry as Attachment).name === 'string',
      )
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function handInHomework(homeworkId: string, formData: FormData): Promise<void> {
  const user = await requireUser();

  const result = await submitHomework({
    homeworkId,
    studentId: user.id,
    body: String(formData.get('body') ?? ''),
    attachments: readAttachments(formData.get('attachments')),
  });

  revalidatePath('/homework');

  redirect(
    result.ok
      ? '/homework?saved=1'
      : `/homework?error=${encodeURIComponent(result.reason ?? 'That did not work.')}`,
  );
}


/**
 * A place to put one file, for one piece of work you are actually on.
 *
 * The entitlement check is the same shape as the messaging one: being on the
 * homework is what earns an upload URL for it, and it is checked here rather
 * than trusted from the form.
 */
export async function requestHomeworkUpload(
  homeworkId: string,
  file: { contentType: string; size: number; name: string },
): Promise<{ ok: true; url: string; headers: Record<string, string>; key: string } | { ok: false; error: string }> {
  const user = await requireUser();

  const rule = UPLOAD_RULES.attachment;
  const contentType = file.contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  if (file.size <= 0) return { ok: false, error: 'That file is empty.' };
  if (file.size > rule.maxBytes) return { ok: false, error: `Too large. Send ${rule.label}.` };
  if (!rule.contentTypes.includes(contentType)) {
    return { ok: false, error: `That file type is not accepted. Send ${rule.label}.` };
  }

  const item = await homeworkForViewer(homeworkId, user.id);
  if (!item) return { ok: false, error: 'That work could not be found.' };

  const key = homeworkKey(homeworkId, randomUUID(), rule.extensionFor[contentType] ?? 'bin');
  const target = await createUploadTarget('private', key, contentType);

  return { ok: true, url: target.url, headers: target.headers, key };
}

/** Turns an uploaded key into the URL stored on the submission. */
export async function homeworkUrlFor(key: string): Promise<string> {
  await requireUser();
  return objectUrl(key);
}
