import { expect, type Page } from '@playwright/test';

export const SEED_PASSWORD = 'tutorly-dev-2026';

export const ACCOUNTS = {
  admin: 'admin@tutorly.test',
  draftTutor: 'newtutor@tutorly.test',
  rejectedTutor: 'rejected.tutor@tutorly.test',
  student: 'student@tutorly.test',
  verifiedTutor: 'tutor@tutorly.test',
} as const;

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
}

export async function signOut(page: Page): Promise<void> {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Sign out' });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
  }
}

/** A tiny valid PNG, built the same way the seed builds avatars. */
export function pngBytes(): Buffer {
  const { deflateSync, crc32 } = require('node:zlib') as typeof import('node:zlib');

  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.byteLength);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const stride = 4 * 3 + 1;
  const raw = Buffer.alloc(stride * 4);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A tiny file that passes the video content-type check. */
export function mp4Bytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypmp42', 'ascii'),
    Buffer.alloc(64),
  ]);
}

/** A minimal valid PDF, so the admin review screen has something to render. */
export function pdfBytes(text: string): Buffer {
  const content = `BT\n/F1 20 Tf\n72 760 Td\n(${text.replace(/[()\\]/g, '')}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];

  const header = '%PDF-1.4\n';
  let body = '';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(header.length + body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = header.length + body.length;
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
  ].join('\n');

  return Buffer.from(
    `${header}${body}${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    'latin1',
  );
}
