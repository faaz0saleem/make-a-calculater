'use client';

/**
 * Uploading an intro video.
 *
 * Three steps, because a video is too big to travel through a Server Action:
 *
 *   1. ask the server for somewhere to put it
 *   2. PUT the bytes straight there — to R2 in production, to our own upload
 *      route in development
 *   3. tell the server the key, so it can probe, check the length and transcode
 *
 * Progress comes from the XHR, so a tutor on a slow connection can see that
 * something is happening rather than staring at a spinner for two minutes.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { attachIntroVideo, requestIntroVideoUpload } from '@/app/tutor/onboarding/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/select';
import { UPLOAD_RULES } from '@/lib/storage/uploads';
import { INTRO_VIDEO_MAX_SECONDS, INTRO_VIDEO_MIN_SECONDS } from '@/lib/video/types';

type Phase = 'idle' | 'uploading' | 'processing';

function put(url: string, headers: Record<string, string>, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`upload failed with ${request.status}`));
    request.onerror = () => reject(new Error('upload failed'));

    request.send(file);
  });
}

export function VideoUploader({ replacing }: { replacing: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const input = event.currentTarget.elements.namedItem('video') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      setError('Choose a video file to upload.');
      return;
    }

    setPhase('uploading');
    setProgress(0);

    try {
      const ticket = await requestIntroVideoUpload({ contentType: file.type, size: file.size });
      if (!ticket.ok) {
        setError(ticket.error);
        setPhase('idle');
        return;
      }

      await put(ticket.url, ticket.headers, file, setProgress);

      setPhase('processing');
      const attached = await attachIntroVideo(ticket.key);
      if (!attached.ok) {
        setError(attached.error ?? 'We could not process that clip.');
        setPhase('idle');
        return;
      }

      router.refresh();
      setPhase('idle');
    } catch {
      setError('The upload did not finish. Check your connection and try again.');
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 border-t border-border pt-5">
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Field
        label={replacing ? 'Replace your intro video' : 'Intro video'}
        htmlFor="video"
        hint={`${INTRO_VIDEO_MIN_SECONDS}–${INTRO_VIDEO_MAX_SECONDS} seconds. Upload ${UPLOAD_RULES.introVideo.label}.`}
      >
        <Input
          id="video"
          name="video"
          type="file"
          accept={UPLOAD_RULES.introVideo.contentTypes.join(',')}
          required
          disabled={busy}
        />
      </Field>

      {phase === 'uploading' ? (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>
        </div>
      ) : null}

      {phase === 'processing' ? (
        <p className="text-xs text-muted-foreground">
          Preparing your clip — trimming a preview and pulling out three thumbnails. This takes a moment.
        </p>
      ) : null}

      <Button type="submit" className="self-start" disabled={busy}>
        {phase === 'uploading' ? 'Uploading…' : phase === 'processing' ? 'Processing…' : replacing ? 'Replace video' : 'Upload video'}
      </Button>
    </form>
  );
}
