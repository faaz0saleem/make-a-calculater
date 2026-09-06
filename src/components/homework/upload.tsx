'use client';

/**
 * Handing work in (SPEC.md §9).
 *
 * Files go straight to the bucket and only their metadata travels through the
 * Server Action — the same three-step path messages and intro videos use, for
 * the same reason: a Server Action body caps at 1 MB and a photographed page of
 * working is bigger than that.
 *
 * Either a written answer or a file is enough. Most homework handed in from a
 * phone is a photo of a page, and demanding a covering note for it would be a
 * form asking a question nobody wants to answer.
 */

import { useRef, useState } from 'react';

import { homeworkUrlFor, requestHomeworkUpload } from '@/app/homework/actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MAX_ATTACHMENT_BYTES } from '@/lib/messaging/limits';

type Pending = { name: string; bytes: number; url: string };

const MAX_FILES = 5;

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

export function HomeworkUpload({
  homeworkId,
  action,
  hasSubmission,
}: {
  homeworkId: string;
  action: (formData: FormData) => void | Promise<void>;
  hasSubmission: boolean;
}) {
  const [attachments, setAttachments] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    if (attachments.length + files.length > MAX_FILES) {
      setError(`Up to ${MAX_FILES} files.`);
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

        const ticket = await requestHomeworkUpload(homeworkId, {
          contentType: file.type,
          size: file.size,
          name: file.name,
        });

        if (!ticket.ok) {
          setError(ticket.error);
          continue;
        }

        await put(ticket.url, ticket.headers, file);
        added.push({ name: file.name, bytes: file.size, url: await homeworkUrlFor(ticket.key) });
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
    <form action={action} className="flex flex-col gap-2" data-testid="hand-in">
      <input type="hidden" name="attachments" value={JSON.stringify(attachments)} />

      <label className="text-xs font-medium" htmlFor={`answer-${homeworkId}`}>
        {hasSubmission ? 'Hand in again — this replaces what you sent' : 'Your answer'}
      </label>
      <Textarea id={`answer-${homeworkId}`} name="body" rows={3} maxLength={20000} />

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
        <Button type="submit" className="min-h-11" disabled={uploading} data-testid="submit-homework">
          {uploading ? 'Uploading…' : hasSubmission ? 'Hand in again' : 'Hand it in'}
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
      </div>
    </form>
  );
}
