import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { expect, type Page } from '@playwright/test';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

/**
 * A direct database read, for assertions about state the UI does not show —
 * the ranking table, for instance.
 *
 * Reading the database beats adding a test-only HTTP route: a fixture endpoint
 * would be real surface on a real deployment, gated by nothing more than an
 * environment variable somebody could forget.
 */
export async function queryDatabase<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

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

/**
 * A real, playable intro video for the upload tests.
 *
 * It has to be genuine: the pipeline probes the file, checks it is between 30
 * and 90 seconds, and transcodes it. A stub with an MP4 header would be
 * rejected, which is the point of the check.
 *
 * Generated once per run and cached, because ffmpeg takes a few seconds.
 */
export async function introVideoBytes(seconds = 35): Promise<Buffer> {
  const { execFile } = await import('node:child_process');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { promisify } = await import('node:util');

  if (cachedIntroVideo) return cachedIntroVideo;

  const run = promisify(execFile);
  const workspace = await mkdtemp(join(tmpdir(), 'tutorly-e2e-video-'));

  try {
    const path = join(workspace, 'intro.mp4');
    await run(
      process.env.FFMPEG_PATH ?? 'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `testsrc2=size=480x270:rate=24:duration=${seconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '34',
        '-c:a', 'aac', '-b:a', '48k', '-shortest',
        path,
      ],
      { timeout: 120_000 },
    );

    cachedIntroVideo = await readFile(path);
    return cachedIntroVideo;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

let cachedIntroVideo: Buffer | null = null;

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
