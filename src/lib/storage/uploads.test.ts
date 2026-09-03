import { describe, expect, it } from 'vitest';

import { checkUpload, UPLOAD_RULES } from './uploads';

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

describe('credential uploads', () => {
  it('accepts a PDF whose bytes match its declared type', () => {
    expect(checkUpload('credential', { size: 1_000, type: 'application/pdf' }, PDF_HEAD)).toEqual({
      ok: true,
      contentType: 'application/pdf',
      extension: 'pdf',
    });
  });

  it('accepts scans as JPEG or PNG', () => {
    expect(checkUpload('credential', { size: 1_000, type: 'image/png' }, PNG_HEAD).ok).toBe(true);
    expect(checkUpload('credential', { size: 1_000, type: 'image/jpeg' }, JPEG_HEAD).ok).toBe(true);
  });

  it('tolerates a charset on the content type', () => {
    expect(checkUpload('credential', { size: 10, type: 'application/pdf; charset=binary' }, PDF_HEAD).ok).toBe(
      true,
    );
  });

  it('rejects an executable renamed to look like a PDF', () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    const result = checkUpload('credential', { size: 1_000, type: 'application/pdf' }, elf);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('does not look like');
  });

  it('rejects a type that is not on the list', () => {
    expect(checkUpload('credential', { size: 100, type: 'application/zip' }).ok).toBe(false);
    expect(checkUpload('credential', { size: 100, type: 'text/html' }).ok).toBe(false);
    expect(checkUpload('credential', { size: 100, type: '' }).ok).toBe(false);
  });

  it('rejects an empty file and one over the size cap', () => {
    expect(checkUpload('credential', { size: 0, type: 'application/pdf' }, PDF_HEAD).ok).toBe(false);
    expect(
      checkUpload('credential', { size: UPLOAD_RULES.credential.maxBytes + 1, type: 'application/pdf' }, PDF_HEAD)
        .ok,
    ).toBe(false);
  });

  it('accepts a file exactly at the cap', () => {
    expect(
      checkUpload('credential', { size: UPLOAD_RULES.credential.maxBytes, type: 'application/pdf' }, PDF_HEAD).ok,
    ).toBe(true);
  });
});

describe('avatar and video uploads', () => {
  it('takes the image and video formats a browser can produce', () => {
    expect(checkUpload('avatar', { size: 1_000, type: 'image/webp' }).ok).toBe(true);
    expect(checkUpload('introVideo', { size: 1_000, type: 'video/mp4' }).ok).toBe(true);
    expect(checkUpload('introVideo', { size: 1_000, type: 'video/quicktime' }).ok).toBe(true);
  });

  it('will not take a video as an avatar, or an image as a video', () => {
    expect(checkUpload('avatar', { size: 1_000, type: 'video/mp4' }).ok).toBe(false);
    expect(checkUpload('introVideo', { size: 1_000, type: 'image/png' }, PNG_HEAD).ok).toBe(false);
  });

  it('caps a video at 200 MB', () => {
    expect(UPLOAD_RULES.introVideo.maxBytes).toBe(200 * 1024 * 1024);
    expect(checkUpload('introVideo', { size: 201 * 1024 * 1024, type: 'video/mp4' }).ok).toBe(false);
  });
});
