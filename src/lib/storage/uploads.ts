/**
 * Upload validation.
 *
 * Everything a tutor sends through the onboarding wizard passes through here
 * first: size, declared type, and — for the formats where it is cheap and
 * decisive — the magic bytes at the start of the file, because the browser's
 * `Content-Type` is a claim, not a fact.
 */

export type UploadKind = 'credential' | 'avatar' | 'introVideo' | 'attachment';

export type UploadRule = {
  maxBytes: number;
  contentTypes: readonly string[];
  extensionFor: Readonly<Record<string, string>>;
  label: string;
};

export const UPLOAD_RULES: Record<UploadKind, UploadRule> = {
  // Credentials and avatars still travel through a Server Action, so they are
  // capped below the 4.5 MB a Vercel function will accept as a request body.
  // If either needs to grow, it moves to the direct-upload path the intro video
  // already uses.
  credential: {
    maxBytes: 4 * 1024 * 1024,
    contentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    extensionFor: { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' },
    label: 'a PDF, JPEG or PNG up to 4 MB',
  },
  avatar: {
    maxBytes: 4 * 1024 * 1024,
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    extensionFor: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
    label: 'a JPEG, PNG or WebP up to 4 MB',
  },
  introVideo: {
    maxBytes: 200 * 1024 * 1024,
    contentTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    extensionFor: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' },
    label: 'an MP4, MOV or WebM up to 200 MB',
  },
  // Homework, a past paper, a photo of a worked answer (SPEC.md §8). Big enough
  // for a scanned book chapter, and on the direct-upload path so it never has
  // to fit through a Server Action.
  attachment: {
    maxBytes: 25 * 1024 * 1024,
    contentTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'],
    extensionFor: {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'text/plain': 'txt',
    },
    label: 'a PDF, image or text file up to 25 MB',
  },
};

/** Leading bytes that identify a format regardless of what the browser claimed. */
const MAGIC: { contentType: string; offset: number; bytes: number[] }[] = [
  { contentType: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { contentType: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { contentType: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

export type UploadCheck =
  | { ok: true; contentType: string; extension: string }
  | { ok: false; reason: string };

export function checkUpload(kind: UploadKind, file: { size: number; type: string }, head?: Uint8Array): UploadCheck {
  const rule = UPLOAD_RULES[kind];

  if (file.size === 0) {
    return { ok: false, reason: 'That file is empty.' };
  }
  if (file.size > rule.maxBytes) {
    return { ok: false, reason: `That file is too large. Upload ${rule.label}.` };
  }

  const declared = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!rule.contentTypes.includes(declared)) {
    return { ok: false, reason: `That file type is not accepted. Upload ${rule.label}.` };
  }

  // If we know the signature for the declared type, the file has to match it.
  const magic = MAGIC.find((candidate) => candidate.contentType === declared);
  if (magic && head) {
    const matches = magic.bytes.every((byte, index) => head[magic.offset + index] === byte);
    if (!matches) {
      return { ok: false, reason: 'That file does not look like the type it claims to be.' };
    }
  }

  const extension = rule.extensionFor[declared];
  if (!extension) {
    return { ok: false, reason: `That file type is not accepted. Upload ${rule.label}.` };
  }

  return { ok: true, contentType: declared, extension };
}
