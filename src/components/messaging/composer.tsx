'use client';

/**
 * Writing a message, with attachments (SPEC.md §8).
 *
 * Files go straight to the bucket and only their metadata travels through the
 * Server Action — the same three-step path the intro video uses, for the same
 * reason: a Server Action body caps at 1 MB and an attachment may be 25.
 *
 * The notice under the box is not decoration. People try to swap numbers here,
 * and being told beforehand that it will be hidden is fairer than watching it
 * vanish after sending.
 *
 * The hint above the Send button goes further: it reads the draft as it is
 * typed and, when it looks like contact details are on their way out, says so
 * *before* anything is sent. It never disables the button and never changes the
 * text. Somebody who reads it and sends anyway has made a decision, and that is
 * a far better thing for a human reviewer to be looking at than a blocked
 * message and a tutor who cannot finish a sentence. The same scorer runs again
 * on the server — this copy is a courtesy, not a control.
 */

import { useMemo, useRef, useState } from 'react';

import { attachmentUrlFor, requestAttachmentUpload } from '@/app/messages/actions';
import { Button } from '@/components/ui/button';
import { scoreContactIntent } from '@/lib/messaging/contact-intent';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_CHARS,
} from '@/lib/messaging/limits';

type Pending = { name: string; bytes: number; url: string };

function put(url: string, headers: Record<string, string>, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.onload = () =>
      request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(String(request.status)));
    request.onerror = () => reject(new Error('upload failed'));
    request.send(file);
  });
}

export function Composer({
  threadId,
  action,
}: {
  threadId: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [attachments, setAttachments] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Cheap enough to run on every keystroke — it is a handful of regexes over at
  // most 4000 characters, and debouncing it would only make the hint arrive
  // after the thing it is about.
  const hint = useMemo(() => scoreContactIntent(draft).hint, [draft]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    if (attachments.length + files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      setError(`Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
      return;
    }

    setUploading(true);
    try {
      const added: Pending[] = [];

      for (const file of Array.from(files)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError(`${file.name} is bigger than 25 MB.`);
          continue;
        }

        const ticket = await requestAttachmentUpload(threadId, {
          contentType: file.type,
          size: file.size,
          name: file.name,
        });

        if (!ticket.ok) {
          setError(ticket.error);
          continue;
        }

        await put(ticket.url, ticket.headers, file);
        added.push({ name: file.name, bytes: file.size, url: await attachmentUrlFor(ticket.key) });
      }

      setAttachments((current) => [...current, ...added]);
    } catch {
      setError('That upload did not finish. Check your connection and try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="threadId" value={threadId} />
      <input type="hidden" name="attachments" value={JSON.stringify(attachments)} />

      <label className="sr-only" htmlFor="message-body">
        Your message
      </label>
      <textarea
        id="message-body"
        name="body"
        rows={3}
        maxLength={MAX_MESSAGE_CHARS}
        placeholder="Write a message…"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {hint ? (
        <p
          role="status"
          data-testid="contact-hint"
          className="rounded-md bg-secondary px-3 py-2 text-xs"
        >
          {hint}
        </p>
      ) : null}

      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-xs">
          {attachments.map((file) => (
            <li key={file.url} className="rounded-full bg-secondary px-3 py-1">
              {file.name} · {Math.max(1, Math.round(file.bytes / 1024))} KB
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="min-h-11" disabled={uploading}>
          {uploading ? 'Uploading…' : 'Send'}
        </Button>

        <label className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary focus-within:ring-2 focus-within:ring-ring">
          Attach a file
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.txt"
            className="sr-only"
            onChange={(event) => void onFiles(event.target.files)}
          />
        </label>

        <p className="text-xs text-muted-foreground">
          Emails, phone numbers and social handles are hidden automatically. Keep payments on Tutorly —
          sessions arranged elsewhere are not covered if something goes wrong.
        </p>
      </div>
    </form>
  );
}
