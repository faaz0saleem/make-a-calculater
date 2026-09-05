import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { chromium, expect, type Browser, type CDPSession, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

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

/**
 * A fresh student account, made directly rather than through the form.
 *
 * The signup form is rate limited to five registrations a minute per IP, which
 * is right in production and wrong for a suite that needs several accounts in a
 * row. Tests that are *about* signup go through the form; tests that merely
 * need somebody new use this.
 *
 * The password hash is copied from a seeded account, so `SEED_PASSWORD` signs
 * in as usual and no bcrypt work happens here.
 */
export async function createStudent(
  email: string,
  overrides: { isAdult?: boolean; country?: string | null; creditsCents?: number } = {},
): Promise<string> {
  return queryDatabase(async (sql) => {
    const [seeded] = await sql`select password_hash from users where email = ${ACCOUNTS.student}`;

    const [created] = await sql`
      insert into users (email, password_hash, name, roles, timezone, country, is_adult, email_verified_at)
      values (
        ${email},
        ${String(seeded!.password_hash)},
        ${email.split('@')[0] ?? 'student'},
        array['student']::user_role[],
        'UTC',
        ${overrides.country ?? null},
        ${overrides.isAdult ?? true},
        now()
      )
      returning id
    `;

    await sql`insert into student_wallets (user_id, credits_cents) values (${created!.id}, 0)`;

    if ((overrides.creditsCents ?? 0) > 0) {
      await grantCredits(created!.id as string, overrides.creditsCents!);
    }

    return created!.id as string;
  });
}

/**
 * Put credits in somebody's wallet, the only way credits are ever allowed to
 * arrive: a paid purchase and a ledger entry, with the column following.
 *
 * Writing `student_wallets.credits_cents` directly is a one-line shortcut that
 * costs the whole reconciliation job — `pnpm reconcile` would report drift
 * after every e2e run, and a check that is expected to fail is a check nobody
 * reads. It also widens the admin dashboard's float by inventing credits
 * nobody paid for.
 */
export async function grantCredits(userId: string, cents: number): Promise<void> {
  await queryDatabase(async (sql) => {
    const [purchase] = await sql`
      insert into credit_purchases
        (user_id, pack_id, paid_cents, credits_cents, provider, provider_ref, status,
         idempotency_key, settled_at)
      values (
        ${userId}, 'standard', ${cents}, ${cents}, 'mock',
        ${`e2e_${randomUUID().slice(0, 8)}`}, 'paid',
        ${`e2e:purchase:${randomUUID()}`}, now()
      )
      returning id
    `;

    await sql`
      insert into ledger_entries (purchase_id, account, owner_id, delta_cents, reason, idempotency_key)
      values (
        ${purchase!.id}, 'student_credits', ${userId}, ${cents},
        'credit_purchase', ${`purchase:${purchase!.id}:credit`}
      )
    `;

    await sql`
      update student_wallets set credits_cents = credits_cents + ${cents}
      where user_id = ${userId}
    `;
  });
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

// ---------------------------------------------------------------------------
// The classroom (Phase 4)
// ---------------------------------------------------------------------------

/**
 * A browser that can hold a real video call.
 *
 * The fake device flags give Chromium a synthetic camera and microphone and
 * auto-accept the permission prompt, so `getUserMedia` succeeds headless. The
 * media is generated, but everything downstream of it — the peer connection,
 * the LiveKit signalling, the webhooks that decide who gets paid — is real.
 */
export async function launchCallBrowser(): Promise<Browser> {
  return chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
  });
}

export type NetworkConditions = {
  offline: boolean;
  /** Added round-trip delay, in milliseconds. */
  latencyMs: number;
  downloadKbps: number;
  uploadKbps: number;
};

/**
 * A Pakistani or Gulf mobile link on a bad day: slow, and slow to answer.
 *
 * Chromium's emulation covers everything that goes through the network stack,
 * which for a LiveKit call is the page itself, the server action that mints the
 * token, and the signalling WebSocket the call is negotiated and recovered
 * over. It does not throttle the media transport, which leaves this sandbox as
 * UDP to 127.0.0.1 — there is no netem in this kernel to shape that with.
 */
export const MOBILE_3G: NetworkConditions = {
  offline: false,
  latencyMs: 300,
  downloadKbps: 1_500,
  uploadKbps: 750,
};

export const OFFLINE: NetworkConditions = {
  offline: true,
  latencyMs: 0,
  downloadKbps: 0,
  uploadKbps: 0,
};

/** Applies network conditions to one page, and returns the CDP session to reuse. */
export async function throttle(
  page: Page,
  conditions: NetworkConditions,
  existing?: CDPSession,
): Promise<CDPSession> {
  const cdp = existing ?? (await page.context().newCDPSession(page));
  if (!existing) await cdp.send('Network.enable');

  await cdp.send('Network.emulateNetworkConditions', {
    offline: conditions.offline,
    latency: conditions.latencyMs,
    downloadThroughput: (conditions.downloadKbps * 1_000) / 8,
    uploadThroughput: (conditions.uploadKbps * 1_000) / 8,
    connectionType: 'cellular3g',
  });

  return cdp;
}

/**
 * A LiveKit webhook, signed the way LiveKit signs one.
 *
 * The receiver checks a JWT whose `sha256` claim is the digest of the exact
 * body, so this exercises the real verification path rather than skipping past
 * it — a test that posted unsigned JSON would prove nothing about the endpoint
 * that decides attendance.
 */
export async function postLiveKitWebhook(
  baseUrl: string,
  event: Record<string, unknown>,
): Promise<Response> {
  const { AccessToken } = await import('livekit-server-sdk');
  const { createHash } = await import('node:crypto');

  const body = JSON.stringify(event);
  const token = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    ttl: '5m',
  });
  token.sha256 = createHash('sha256').update(body).digest('base64');

  return fetch(`${baseUrl}/api/livekit/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/webhook+json', authorization: await token.toJwt() },
    body,
  });
}

/** Builds one LiveKit webhook body. `at` is the moment it describes. */
export function liveKitEvent(options: {
  event: string;
  roomName: string;
  at: Date;
  identity?: string;
  id?: string;
}): Record<string, unknown> {
  return {
    event: options.event,
    id: options.id ?? randomUUID(),
    createdAt: String(Math.floor(options.at.getTime() / 1_000)),
    room: { sid: `RM_${options.roomName}`, name: options.roomName },
    ...(options.identity
      ? { participant: { sid: `PA_${options.identity}`, identity: options.identity } }
      : {}),
  };
}

/** The narrow phone the market actually browses on. */
export const PHONE_WIDTH = 360;

/** Nothing may overflow horizontally: a phone should never scroll sideways. */
export async function expectNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const offenders: string[] = [];

    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0) continue;
      // An element inside its own horizontal scroller is allowed to be wider
      // than the screen — the subject chips and the rails are meant to be
      // swiped. The page itself is not.
      const scroller = element.closest('[data-scroll-x]');
      if (scroller && scroller !== element) continue;
      if (box.right > root.clientWidth + 1) {
        offenders.push(`${element.tagName.toLowerCase()}.${element.className}`.slice(0, 120));
      }
    }

    return { pageWidth: root.scrollWidth, viewport: root.clientWidth, offenders: offenders.slice(0, 5) };
  });

  expect(
    overflow.pageWidth,
    `${where} scrolls sideways at ${PHONE_WIDTH}px. First offenders: ${overflow.offenders.join(' | ')}`,
  ).toBeLessThanOrEqual(overflow.viewport + 1);
}

