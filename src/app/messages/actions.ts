'use server';

/**
 * Messaging actions (SPEC.md §8).
 *
 * Nothing here decides who the sender is from the form — it comes from the
 * session, and `sendMessage` refuses a thread the sender is not in. Bodies are
 * masked inside `sendMessage`, on write, so there is no path that stores raw
 * text as the readable one.
 */

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  MAX_ATTACHMENT_BYTES,
  loadThreadForViewer,
  sendMessage,
  type Attachment,
} from '@/db/messages';
import { ensureThread } from '@/db/trials';
import { db } from '@/db/client';
import { bookings } from '@/db/schema';
import { and, eq, or } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/guards';
import { attachmentKey, createUploadTarget, objectUrl } from '@/lib/storage';
import { UPLOAD_RULES } from '@/lib/storage/uploads';

const SEND_ERRORS: Record<string, string> = {
  not_in_thread: 'That conversation could not be found.',
  empty: 'Write something, or attach a file.',
  too_long: 'That message is too long.',
  too_many_attachments: 'Five attachments per message.',
  attachment_too_big: 'Attachments are limited to 25 MB.',
};

export async function postMessage(formData: FormData): Promise<void> {
  const user = await requireUser();

  const threadId = String(formData.get('threadId') ?? '');
  const body = String(formData.get('body') ?? '');

  // Attachments arrive as metadata: the bytes went straight to the bucket.
  let attachments: Attachment[] = [];
  const raw = String(formData.get('attachments') ?? '');
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        attachments = parsed
          .filter((item): item is Attachment => {
            if (typeof item !== 'object' || item === null) return false;
            const file = item as Partial<Attachment>;
            return (
              typeof file.url === 'string' &&
              typeof file.name === 'string' &&
              typeof file.bytes === 'number' &&
              file.bytes > 0 &&
              file.bytes <= MAX_ATTACHMENT_BYTES
            );
          })
          .map((file) => ({ url: file.url, name: file.name.slice(0, 120), bytes: file.bytes }));
      }
    } catch {
      attachments = [];
    }
  }

  const result = await sendMessage({ threadId, senderId: user.id, body, attachments });

  if (!result.ok) {
    redirect(`/messages/${threadId}?error=${encodeURIComponent(SEND_ERRORS[result.reason] ?? 'Not sent.')}`);
  }

  revalidatePath(`/messages/${threadId}`);
  revalidatePath('/messages');
  redirect(`/messages/${threadId}`);
}

/**
 * Somewhere to PUT an attachment.
 *
 * The key is derived from the thread, and the caller has to be in that thread —
 * so a signed upload URL cannot be obtained for somebody else's conversation.
 */
export async function requestAttachmentUpload(
  threadId: string,
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

  // Being in the thread is what entitles you to an upload URL for it.
  const view = await loadThreadForViewer(threadId, user.id);
  if (!view) return { ok: false, error: 'That conversation could not be found.' };

  const key = attachmentKey(threadId, randomUUID(), rule.extensionFor[contentType] ?? 'bin');
  const target = await createUploadTarget('private', key, contentType);

  return { ok: true, url: target.url, headers: target.headers, key };
}

/** Turns an uploaded key into the URL stored on the message. */
export async function attachmentUrlFor(key: string): Promise<string> {
  await requireUser();
  return objectUrl(key);
}

/**
 * Open (or find) the thread with someone you already have a booking with.
 *
 * No cold DMs: without a booking or a trial request between the two of you,
 * this refuses rather than creating a thread (SPEC.md §8).
 */
export async function openThreadWith(otherId: string): Promise<void> {
  const user = await requireUser();

  const [existing] = await db
    .select({ id: bookings.id, studentId: bookings.studentId, tutorId: bookings.tutorId })
    .from(bookings)
    .where(
      or(
        and(eq(bookings.studentId, user.id), eq(bookings.tutorId, otherId)),
        and(eq(bookings.studentId, otherId), eq(bookings.tutorId, user.id)),
      ),
    )
    .limit(1);

  if (!existing) redirect('/messages?error=no-booking');

  const threadId = await ensureThread(existing.studentId, existing.tutorId);
  redirect(`/messages/${threadId}`);
}
