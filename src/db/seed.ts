/**
 * Seed a realistic world (SPEC.md §13.8).
 *
 * Produces, deterministically:
 *   - 12 subjects from the category taxonomy in SPEC.md §4
 *   - 1 admin, 10 students with credit balances, 45 tutors
 *   - 40 verified tutors across 10 timezones with varied rates, subjects,
 *     availability patterns and ratings
 *   - 5 tutors in `pending_review` with uploaded credentials waiting
 *   - a history of completed, cancelled and no-show sessions, with reviews
 *   - one tutor with exactly $100.00 available and a payout request waiting,
 *     one sitting at exactly $100.00 who has not requested, and one at $99.50
 *     who is not allowed to (SPEC.md §16)
 *
 * Every balance is built by appending real ledger entries, so `pnpm reconcile`
 * passes against the seeded world rather than merely against an empty one.
 *
 * Run with `pnpm seed`. It truncates first, so it is safe to re-run.
 */

import '@/scripts/bootstrap';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sql } from 'drizzle-orm';

import { db } from './client';
import { appendLedger, formatReconciliationReport, reconcileLedger } from './ledger';
import { formatRankingRun, recomputeTutorRanking } from './ranking';
import {
  availabilityRules,
  bookings,
  creditPacks,
  creditPurchases,
  credentials,
  follows,
  payoutMethods,
  payouts,
  reviews,
  studentWallets,
  subjects,
  tutorLanguages,
  tutorProfiles,
  tutorRanking,
  tutorSubjects,
  users,
  videos,
} from './schema';
import { colourFor, simplePdf, solidPng } from './seed-assets';
import { hashPassword } from '@/lib/auth/password';
import type { UserRole } from '@/lib/auth/roles';
import { encryptSecret, last4 } from '@/lib/crypto';
import { formatCents } from '@/lib/money/cents';
import {
  bookingEscrowEntries,
  creditPurchaseEntries,
  payoutRequestEntries,
  pendingToAvailableEntries,
} from '@/lib/money/ledger';
import { CREDIT_PACKS, type CreditPack } from '@/lib/money/packs';
import { resolveBookingOutcome, type Attendance, type BookingForOutcome } from '@/lib/money/outcomes';
import { deriveHalfHourCents, priceForBooking } from '@/lib/money/pricing';
import { avatarKey, credentialKey, getObjectStore, publicUrlFor } from '@/lib/storage';
import { getVideoPipeline, isVideoPipelineAvailable } from '@/lib/video';
import { LANGUAGES } from '@/lib/tutors/languages';
import { clockToString, getLocalParts, zonedTimeToUtc } from '@/lib/time';

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32: small, fast, and identical on every machine. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(20260415);

function randInt(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick called with an empty array');
  return item;
}

function pickMany<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const chosen: T[] = [];
  while (chosen.length < count && pool.length > 0) {
    const [taken] = pool.splice(Math.floor(random() * pool.length), 1);
    if (taken !== undefined) chosen.push(taken);
  }
  return chosen;
}

function chance(probability: number): boolean {
  return random() < probability;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const SEED_PASSWORD = 'tutorly-dev-2026';

/** "Now" for the seeded world. Bookings are placed relative to this. */
const NOW = new Date();

const SUBJECTS = [
  { slug: 'math', name: 'Math' },
  { slug: 'physics', name: 'Physics' },
  { slug: 'chemistry', name: 'Chemistry' },
  { slug: 'biology', name: 'Biology' },
  { slug: 'english', name: 'English' },
  { slug: 'ielts-toefl', name: 'IELTS / TOEFL' },
  { slug: 'programming', name: 'Programming' },
  { slug: 'quran-arabic', name: 'Quran & Arabic' },
  { slug: 'business', name: 'Business' },
  { slug: 'music', name: 'Music' },
  { slug: 'test-prep', name: 'Test Prep' },
  { slug: 'languages', name: 'Languages' },
] as const;

const LOCALES = [
  { timezone: 'Asia/Karachi', country: 'PK', city: 'Karachi' },
  { timezone: 'America/New_York', country: 'US', city: 'New York' },
  { timezone: 'Europe/London', country: 'GB', city: 'London' },
  { timezone: 'Asia/Dubai', country: 'AE', city: 'Dubai' },
  { timezone: 'Asia/Kolkata', country: 'IN', city: 'Bengaluru' },
  { timezone: 'Australia/Sydney', country: 'AU', city: 'Sydney' },
  { timezone: 'Africa/Lagos', country: 'NG', city: 'Lagos' },
  { timezone: 'America/Los_Angeles', country: 'US', city: 'Los Angeles' },
  { timezone: 'Europe/Berlin', country: 'DE', city: 'Berlin' },
  { timezone: 'Asia/Manila', country: 'PH', city: 'Manila' },
] as const;

const FIRST_NAMES = [
  'Ayesha', 'Bilal', 'Chen', 'Daniyal', 'Elena', 'Farah', 'Grace', 'Hassan',
  'Imran', 'Jasmine', 'Kiran', 'Leila', 'Mateo', 'Nadia', 'Omar', 'Priya',
  'Qasim', 'Rania', 'Samir', 'Tariq', 'Uzma', 'Victor', 'Wei', 'Xiomara',
  'Yusuf', 'Zainab', 'Adeel', 'Bushra', 'Carlos', 'Dina', 'Emeka', 'Fatima',
  'Gabriel', 'Hina', 'Ibrahim', 'Julia', 'Kamal', 'Lina', 'Marcus', 'Noor',
  'Olga', 'Pedro', 'Rabia', 'Sana', 'Tomas', 'Usman', 'Vera', 'Waleed',
  'Yara', 'Zoya', 'Ahmed', 'Bianca', 'Danish', 'Ella', 'Faisal',
];

const LAST_NAMES = [
  'Khan', 'Ahmed', 'Silva', 'Okafor', 'Novak', 'Iqbal', 'Ramirez', 'Chowdhury',
  'Petrov', 'Nakamura', 'Hassan', 'Dubois', 'Fernandez', 'Malik', 'Adeyemi',
  'Rossi', 'Sharma', 'Zhang', 'Okonkwo', 'Bashir', 'Costa', 'Haddad', 'Weber',
  'Santos', 'Rahman', 'Alvarez', 'Bhatti', 'Delgado', 'Farooq', 'Grant',
];

const HEADLINES = [
  'Exam-focused {subject} tutor — 8 years, 900+ hours',
  'Make {subject} finally click',
  '{subject} for absolute beginners, patiently',
  'University {subject} lecturer, evenings and weekends',
  'Top-grade {subject} coaching with weekly practice sets',
  'Conversational, no-jargon {subject} lessons',
  '{subject} tutor who actually explains the why',
  'From failing to A grade in {subject}',
];

const BIO_PARTS = [
  'I have spent the last {years} years teaching {subject} to students from complete beginners through to university entrance.',
  'My lessons are built around your syllabus and your deadlines, not a generic curriculum.',
  'Every session ends with a short set of practice problems and a written summary you keep.',
  'I record the key steps on a shared whiteboard so you can revise exactly what we covered.',
  'Most of my students come to me nervous about an exam; we work backwards from the paper.',
  'I teach in plain language and I will never make you feel slow for asking twice.',
  'Book a free trial first — I would rather you find the right tutor than the first one.',
];

const REVIEW_BODIES = [
  'Explained a topic I had been stuck on for weeks in about twenty minutes.',
  'Patient, well prepared, and turned up on time every session.',
  'Went through my past papers question by question. My grade went up two bands.',
  'Very good teacher. Sometimes we ran slightly over, which I did not mind.',
  'Clear explanations and useful homework. Would book again.',
  'Friendly and encouraging. My daughter actually looks forward to the lessons now.',
  'Good session overall, though the connection dropped once.',
  'Knows the syllabus inside out.',
  null,
  null,
];

const CREDENTIAL_TEMPLATES = [
  { kind: 'degree' as const, title: 'BSc Mathematics', institution: 'University of Punjab' },
  { kind: 'degree' as const, title: 'MSc Physics', institution: 'Imperial College London' },
  { kind: 'teaching_licence' as const, title: 'QTS Teaching Licence', institution: 'UK Department for Education' },
  { kind: 'certificate' as const, title: 'CELTA', institution: 'Cambridge Assessment English' },
  { kind: 'diploma' as const, title: 'Diploma in Computer Science', institution: 'NUST' },
  { kind: 'degree' as const, title: 'BA English Literature', institution: 'University of Toronto' },
  { kind: 'certificate' as const, title: 'IELTS Examiner Training', institution: 'British Council' },
  { kind: 'id' as const, title: 'National Identity Card', institution: 'NADRA' },
];

const LEVELS = ['beginner', 'intermediate', 'advanced', 'exam_prep'] as const;

/**
 * Tutors whose balance has to land on an exact number for the payout tests in
 * SPEC.md §16. They are kept out of the random session history so their earnings
 * come only from the one engineered session in `seedPayoutFixtures`.
 */
const PAYOUT_FIXTURE_EMAILS = [
  'payout.pending@tutorly.test',
  'payout.ready@tutorly.test',
  'payout.short@tutorly.test',
] as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function emailFor(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '.');
  return `${slug}.${index}@tutorly.test`;
}

function daysFromNow(days: number, hourUtc: number, minuteUtc = 0): Date {
  const date = new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
  date.setUTCHours(hourUtc, minuteUtc, 0, 0);
  return date;
}

/** Rounds an instant down onto the 30-minute slot grid. */
function onSlotGrid(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCMinutes(copy.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return copy;
}

type SeededTutor = {
  id: string;
  name: string;
  email: string;
  timezone: string;
  hourlyCents: number;
  halfHourCents: number;
  commissionBps: number;
  offersTrial: boolean;
  ratingBias: number;
  subjectSlugs: string[];
};

type SeededStudent = {
  id: string;
  name: string;
  email: string;
  timezone: string;
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function reset(): Promise<void> {
  // One statement so foreign keys never block the order.
  await db.execute(sql`
    truncate table
      ledger_entries, session_events, reviews, bookings,
      payouts, payout_methods, credit_purchases, credit_packs,
      follows, messages, threads, reports, admin_audit,
      availability_exceptions, availability_rules,
      tutor_subjects, tutor_languages, tutor_ranking, credentials, tutor_profiles,
      student_wallets, platform_accounts, videos, subjects,
      accounts, sessions, verification_tokens, users
    restart identity cascade
  `);
}

/**
 * Clears the development object store so re-seeding does not leave orphaned
 * files behind. Only ever touches the local directory — R2 is left alone.
 */
async function resetLocalStorage(): Promise<void> {
  if (process.env.R2_ACCOUNT_ID) return;
  const directory = process.env.LOCAL_STORAGE_DIR ?? '.storage';
  await rm(directory, { recursive: true, force: true });
}

const runCommand = promisify(execFile);

/**
 * Intro videos for the seeded world.
 *
 * Four synthetic clips are generated with ffmpeg and pushed through the real
 * pipeline — the same code path a tutor's upload takes — then shared across the
 * seeded tutors. Forty-six separate transcodes would take seven minutes and
 * several hundred megabytes to produce forty-six near-identical test patterns;
 * four takes half a minute and exercises exactly the same code.
 *
 * With no ffmpeg on the machine the seed says so and leaves the videos without
 * media, rather than failing.
 */
const SEED_CLIP_SOURCES = [
  { source: 'testsrc2=size=640x360:rate=24', seconds: 34 },
  { source: 'smptebars=size=640x360:rate=24', seconds: 48 },
  { source: 'rgbtestsrc=size=640x360:rate=24', seconds: 62 },
  { source: 'testsrc=size=640x360:rate=24', seconds: 81 },
];

type SeedClip = {
  hlsUrl: string;
  previewUrl: string;
  thumbnailUrls: string[];
  durationS: number;
  width: number;
  height: number;
};

async function buildSeedClips(): Promise<SeedClip[] | null> {
  if (!(await isVideoPipelineAvailable())) return null;

  const pipeline = getVideoPipeline();
  const store = getObjectStore();
  const workspace = await mkdtemp(join(tmpdir(), 'tutorly-seed-video-'));
  const clips: SeedClip[] = [];

  try {
    for (const [index, clip] of SEED_CLIP_SOURCES.entries()) {
      const path = join(workspace, `clip-${index}.mp4`);
      await runCommand(
        'ffmpeg',
        [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'lavfi', '-i', `${clip.source}:duration=${clip.seconds}`,
          '-f', 'lavfi', '-i', `sine=frequency=${220 + index * 110}:duration=${clip.seconds}`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
          '-c:a', 'aac', '-b:a', '64k', '-shortest',
          path,
        ],
        { timeout: 120_000 },
      );

      const sourceKey = `videos/seed/${index}/source.mp4`;
      await store.put('public', sourceKey, new Uint8Array(await readFile(path)), 'video/mp4');

      const output = await pipeline.transcode({ sourceKey, ownerId: 'seed', videoId: String(index) });

      clips.push({
        hlsUrl: publicUrlFor(output.hlsKey),
        previewUrl: publicUrlFor(output.previewKey),
        thumbnailUrls: output.thumbnailKeys.map(publicUrlFor),
        durationS: Math.round(output.durationSeconds),
        width: output.width,
        height: output.height,
      });
    }

    return clips;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function seedCreditPacks(): Promise<void> {
  await db.insert(creditPacks).values(
    CREDIT_PACKS.map((pack) => ({
      id: pack.id,
      name: pack.name,
      paidCents: pack.paidCents,
      creditsCents: pack.creditsCents,
      sortOrder: pack.sortOrder,
      active: true,
    })),
  );
}

async function seedSubjects(): Promise<Map<string, string>> {
  const rows = SUBJECTS.map((subject, index) => ({
    id: randomUUID(),
    slug: subject.slug,
    name: subject.name,
    sortOrder: index,
  }));
  await db.insert(subjects).values(rows);
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function seedAdmin(passwordHash: string): Promise<string> {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    email: 'admin@tutorly.test',
    passwordHash,
    roles: ['admin', 'student'] as UserRole[],
    name: 'Ops Admin',
    timezone: 'Asia/Karachi',
    country: 'PK',
    city: 'Karachi',
    emailVerified: NOW,
  });
  await db.insert(studentWallets).values({ userId: id });
  return id;
}

async function seedStudents(passwordHash: string, wallets: Wallets): Promise<SeededStudent[]> {
  const students: SeededStudent[] = [];

  for (let index = 0; index < 10; index += 1) {
    const locale = LOCALES[index % LOCALES.length]!;
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    students.push({
      id: randomUUID(),
      name,
      email: emailFor(name, index + 1),
      timezone: locale.timezone,
    });
  }

  // A fixed student in New York, so the Karachi/New York DST scenario in
  // SPEC.md §13.2 always has a real pair to exercise.
  students[0] = {
    id: randomUUID(),
    name: 'Nina Alvarez',
    email: 'student@tutorly.test',
    timezone: 'America/New_York',
  };

  await db.insert(users).values(
    students.map((student, index) => ({
      id: student.id,
      email: student.email,
      passwordHash,
      roles: ['student'] as UserRole[],
      name: student.name,
      timezone: student.timezone,
      country: LOCALES[index % LOCALES.length]!.country,
      city: LOCALES[index % LOCALES.length]!.city,
      emailVerified: NOW,
    })),
  );

  await db.insert(studentWallets).values(students.map((student) => ({ userId: student.id })));

  // Credits arrive the only way they ever should: a settled purchase that
  // appends to the ledger.
  for (const [index, student] of students.entries()) {
    const packCount = index === 0 ? 3 : randInt(1, 2);
    for (let purchase = 0; purchase < packCount; purchase += 1) {
      await recordPurchase(wallets, student.id, pick(CREDIT_PACKS));
    }
  }

  return students;
}

/**
 * Wallet balances as the seed builds them.
 *
 * A student can never spend credits they do not have, so the seed tracks the
 * running balance and tops up before booking — exactly what the booking flow
 * does with its inline top-up step (SPEC.md §5).
 */
type Wallets = Map<string, number>;

async function recordPurchase(wallets: Wallets, userId: string, pack: CreditPack): Promise<void> {
  const purchaseId = randomUUID();

  await db.insert(creditPurchases).values({
    id: purchaseId,
    userId,
    packId: pack.id,
    paidCents: pack.paidCents,
    creditsCents: pack.creditsCents,
    provider: 'mock',
    providerRef: `mock_${purchaseId.slice(0, 8)}`,
    status: 'paid',
    idempotencyKey: `mock:purchase:${purchaseId}`,
    settledAt: NOW,
  });

  await appendLedger(db, creditPurchaseEntries({ purchaseId, userId, creditsCents: pack.creditsCents }));
  wallets.set(userId, (wallets.get(userId) ?? 0) + pack.creditsCents);
}

/** Top up until the student can afford `needCents`, smallest sufficient pack first. */
async function ensureCredits(wallets: Wallets, userId: string, needCents: number): Promise<void> {
  while ((wallets.get(userId) ?? 0) < needCents) {
    const shortfall = needCents - (wallets.get(userId) ?? 0);
    const pack =
      CREDIT_PACKS.find((candidate) => candidate.creditsCents >= shortfall) ??
      CREDIT_PACKS[CREDIT_PACKS.length - 1]!;
    await recordPurchase(wallets, userId, pack);
  }
}

/**
 * Availability: three patterns, so the feed has weekday-evening tutors,
 * weekend tutors and all-day tutors rather than one uniform grid.
 */
function availabilityPatternFor(index: number): { weekdays: number[]; startHour: number; endHour: number } {
  switch (index % 3) {
    case 0:
      return { weekdays: [1, 2, 3, 4, 5], startHour: 17, endHour: 22 }; // weekday evenings
    case 1:
      return { weekdays: [0, 6], startHour: 9, endHour: 18 }; // weekends
    default:
      return { weekdays: [1, 3, 5], startHour: 8, endHour: 20 }; // long days, alternate
  }
}

/**
 * Which profile status each seeded tutor gets, by position:
 * 0-39 verified, 40-44 waiting in the queue, 45 a blank draft, 46 rejected.
 */
function statusForIndex(index: number): 'verified' | 'pending_review' | 'draft' | 'rejected' {
  if (index < 40) return 'verified';
  if (index < 45) return 'pending_review';
  return index === 45 ? 'draft' : 'rejected';
}

async function seedTutors(
  subjectIds: Map<string, string>,
  passwordHash: string,
  clips: SeedClip[] | null,
): Promise<{
  verified: SeededTutor[];
  pending: SeededTutor[];
}> {
  const verified: SeededTutor[] = [];
  const pending: SeededTutor[] = [];

  // 40 verified, 5 awaiting review, then one draft and one rejected so the
  // wizard and the rejection path both have a real account to walk through.
  const total = 47;
  for (let index = 0; index < total; index += 1) {
    const isVerified = index < 40;
    const locale = LOCALES[index % LOCALES.length]!;
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const hourlyCents = pick([500, 800, 1_200, 1_500, 1_800, 2_000, 2_500, 3_000, 3_500, 4_000, 5_000, 6_500, 8_000, 12_000, 20_000]);

    const tutor: SeededTutor = {
      id: randomUUID(),
      name,
      email: emailFor(name, 100 + index),
      timezone: locale.timezone,
      hourlyCents,
      halfHourCents: deriveHalfHourCents(hourlyCents),
      // A handful of early tutors negotiated 15%.
      commissionBps: index % 9 === 0 ? 1_500 : 2_000,
      offersTrial: chance(0.6),
      ratingBias: pick([4.1, 4.4, 4.6, 4.7, 4.8, 4.9, 5.0, 3.9]),
      subjectSlugs: pickMany(
        SUBJECTS.map((subject) => subject.slug),
        randInt(1, 3),
      ),
    };

    (isVerified ? verified : pending).push(tutor);
  }

  // The two accounts used to demonstrate the onboarding journey by hand.
  const draftTutor = pending[5]!;
  draftTutor.email = 'newtutor@tutorly.test';
  draftTutor.name = 'Amara Nwosu';
  draftTutor.timezone = 'Africa/Lagos';
  draftTutor.subjectSlugs = [];

  const rejectedTutor = pending[6]!;
  rejectedTutor.email = 'rejected.tutor@tutorly.test';
  rejectedTutor.name = 'Tomas Varga';
  rejectedTutor.timezone = 'Europe/Berlin';

  // Three fixed tutors for the payout boundary cases in SPEC.md §16. Their rates
  // are chosen so a single completed 60-minute session lands the balance exactly
  // on the number the test cares about.
  const fixtures: { index: number; email: string; name: string; hourlyCents: number; timezone: string }[] = [
    { index: 0, email: 'payout.pending@tutorly.test', name: 'Sadia Mahmood', hourlyCents: 12_500, timezone: 'Asia/Karachi' },
    { index: 1, email: 'payout.ready@tutorly.test', name: 'Daniel Okafor', hourlyCents: 12_500, timezone: 'Africa/Lagos' },
    { index: 2, email: 'payout.short@tutorly.test', name: 'Mei Lin Zhang', hourlyCents: 12_437, timezone: 'Asia/Manila' },
  ];

  for (const fixture of fixtures) {
    const tutor = verified[fixture.index]!;
    tutor.email = fixture.email;
    tutor.name = fixture.name;
    tutor.hourlyCents = fixture.hourlyCents;
    tutor.halfHourCents = deriveHalfHourCents(fixture.hourlyCents);
    tutor.timezone = fixture.timezone;
    tutor.commissionBps = 2_000;
  }

  // A predictable Karachi tutor for the DST scenario and for manual clicking.
  const demoTutor = verified[3]!;
  demoTutor.email = 'tutor@tutorly.test';
  demoTutor.name = 'Hassan Raza';
  demoTutor.timezone = 'Asia/Karachi';
  demoTutor.offersTrial = true;

  const all = [...verified, ...pending];

  // Real bytes in the object store, so the app never renders a broken image.
  const store = getObjectStore();
  const avatarUrls = new Map<string, string>();

  for (const [index, tutor] of all.entries()) {
    if (statusForIndex(index) === 'draft') continue; // the draft account uploads its own
    const key = avatarKey(tutor.id, 'seed', 'png');
    await store.put('public', key, solidPng(96, 96, colourFor(tutor.id)), 'image/png');
    avatarUrls.set(tutor.id, `/api/public-files/${key}`);
  }

  await db.insert(users).values(
    all.map((tutor, index) => {
      const locale = LOCALES[index % LOCALES.length]!;
      return {
        id: tutor.id,
        email: tutor.email,
        passwordHash,
        roles: ['tutor', 'student'] as UserRole[],
        name: tutor.name,
        timezone: tutor.timezone,
        country: locale.country,
        city: locale.city,
        image: avatarUrls.get(tutor.id) ?? null,
        emailVerified: NOW,
      };
    }),
  );

  // Tutors can take lessons too, so they get a wallet as well.
  await db.insert(studentWallets).values(all.map((tutor) => ({ userId: tutor.id })));

  const videoRows = all
    .filter((_, index) => statusForIndex(index) !== 'draft')
    .map((tutor, index) => {
      const clip = clips ? clips[index % clips.length]! : null;
      return {
        id: randomUUID(),
        ownerId: tutor.id,
        hlsUrl: clip?.hlsUrl ?? null,
        previewUrl: clip?.previewUrl ?? null,
        // Rotate which candidate is chosen, so the feed is not a wall of the
        // same still.
        thumbnailUrl: clip ? (clip.thumbnailUrls[index % clip.thumbnailUrls.length] ?? null) : null,
        thumbnailCandidates: clip?.thumbnailUrls ?? [],
        durationS: clip?.durationS ?? randInt(30, 90),
        width: clip?.width ?? null,
        height: clip?.height ?? null,
        status: 'ready' as const,
      };
    });
  await db.insert(videos).values(videoRows);
  const videoByTutor = new Map(videoRows.map((row) => [row.ownerId, row.id]));

  await db.insert(tutorProfiles).values(
    all.map((tutor, index) => {
      const isVerified = index < 40;
      const status = statusForIndex(index);
      const isBlank = status === 'draft';
      const primarySubject =
        SUBJECTS.find((subject) => subject.slug === tutor.subjectSlugs[0]) ?? SUBJECTS[0]!;
      const promoActive = isVerified && index % 11 === 0;

      return {
        userId: tutor.id,
        status,
        // The draft account starts genuinely empty, so the wizard has something
        // to actually fill in.
        headline: isBlank ? null : pick(HEADLINES).replace('{subject}', primarySubject.name).slice(0, 80),
        bio: isBlank
          ? null
          : pickMany(BIO_PARTS, 4)
              .join(' ')
              .replace('{years}', String(randInt(2, 15)))
              .replace('{subject}', primarySubject.name),
        introVideoId: isBlank ? null : (videoByTutor.get(tutor.id) ?? null),
        hourlyCents: tutor.hourlyCents,
        halfHourCents: tutor.halfHourCents,
        promoCents: promoActive ? Math.max(500, Math.round(tutor.hourlyCents * 0.8)) : null,
        promoStartsAt: promoActive ? daysFromNow(-3, 0) : null,
        promoEndsAt: promoActive ? daysFromNow(11, 0) : null,
        commissionBps: tutor.commissionBps,
        offersTrial: tutor.offersTrial,
        trialMinutes: pick([10, 15, 20]),
        maxTrialsPerWeek: randInt(3, 8),
        bufferMinutes: pick([0, 5, 10, 15]),
        maxSessionsPerDay: randInt(4, 10),
        bookingHorizonDays: 30,
        minLeadMinutes: 60,
        // A handful were verified in the last fortnight, so the exploration
        // slot in the ranking score — and the "New tutors" rail — have someone
        // to show.
        verifiedAt: isVerified ? daysFromNow(-(index % 9 === 4 ? randInt(1, 14) : randInt(35, 300)), 9) : null,
        submittedAt: status === 'draft' ? null : daysFromNow(-randInt(1, 320), 9),
        rejectionReason:
          status === 'rejected'
            ? 'The name on your teaching licence does not match the name on your profile. Upload a document in the same name, or update your profile to match your documents.'
            : null,
        strikes: isVerified && chance(0.1) ? 1 : 0,
        responseMedianSeconds: randInt(240, 14_400),
      };
    }),
  );

  await db.insert(tutorSubjects).values(
    all.flatMap((tutor) =>
      tutor.subjectSlugs.map((slug) => ({
        tutorId: tutor.id,
        subjectId: subjectIds.get(slug)!,
        level: pick(LEVELS),
        yearsExperience: randInt(1, 15),
      })),
    ),
  );

  // Languages (SPEC.md §3 step 2). Everyone teaches in English plus, usually,
  // one more; the blank draft account has none.
  await db.insert(tutorLanguages).values(
    all.flatMap((tutor, index) => {
      if (statusForIndex(index) === 'draft') return [];
      const extras = pickMany(
        LANGUAGES.filter((language) => language.code !== 'en'),
        randInt(0, 2),
      );
      return [
        { tutorId: tutor.id, languageCode: 'en', proficiency: pick(['fluent', 'native'] as const) },
        ...extras.map((language) => ({
          tutorId: tutor.id,
          languageCode: language.code,
          proficiency: pick(['conversational', 'fluent', 'native'] as const),
        })),
      ];
    }),
  );

  // Credentials: verified tutors have approved ones, the pending five have
  // documents sitting in the admin queue. The blank draft account has none.
  const credentialRows: (typeof credentials.$inferInsert)[] = [];

  for (const [index, tutor] of all.entries()) {
    const status = statusForIndex(index);
    if (status === 'draft') continue;

    const isVerified = status === 'verified';
    const templates = pickMany(CREDENTIAL_TEMPLATES, isVerified ? randInt(1, 2) : 2);

    for (const template of templates) {
      const credentialId = randomUUID();
      const year = randInt(2005, 2024);
      // Private bucket. Only ever reached through a 60-second signed URL.
      const key = credentialKey(tutor.id, credentialId, 'pdf');

      await store.put(
        'private',
        key,
        simplePdf([template.title, template.institution, String(year), tutor.name]),
        'application/pdf',
      );

      credentialRows.push({
        id: credentialId,
        tutorId: tutor.id,
        kind: template.kind,
        title: template.title,
        institution: template.institution,
        year,
        fileKey: key,
        status: isVerified ? 'approved' : 'pending',
        reviewedAt: isVerified ? daysFromNow(-randInt(30, 300), 10) : null,
      });
    }
  }

  await db.insert(credentials).values(credentialRows);

  await db.insert(availabilityRules).values(
    all.flatMap((tutor, index) => {
      if (statusForIndex(index) === 'draft') return [];
      const pattern = availabilityPatternFor(index);
      return pattern.weekdays.map((weekdayLocal) => {
        // Convert the tutor's local window to UTC using a reference week, then
        // keep the local copy alongside it (see DECISIONS_NEEDED.md).
        const reference = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
        const referenceParts = getLocalParts(reference, tutor.timezone);
        const dayShift = (weekdayLocal - referenceParts.weekday + 7) % 7;

        const startUtc = zonedTimeToUtc(
          {
            year: referenceParts.year,
            month: referenceParts.month,
            day: referenceParts.day + dayShift,
            hour: pattern.startHour,
          },
          tutor.timezone,
        );
        const endUtc = zonedTimeToUtc(
          {
            year: referenceParts.year,
            month: referenceParts.month,
            day: referenceParts.day + dayShift,
            hour: pattern.endHour,
          },
          tutor.timezone,
        );

        return {
          tutorId: tutor.id,
          weekday: startUtc.getUTCDay(),
          startTimeUtc: clockToString(startUtc.getUTCHours(), startUtc.getUTCMinutes()),
          endTimeUtc: clockToString(endUtc.getUTCHours(), endUtc.getUTCMinutes()),
          weekdayLocal,
          startTimeLocal: clockToString(pattern.startHour, 0),
          endTimeLocal: clockToString(pattern.endHour, 0),
          timezone: tutor.timezone,
          active: true,
        };
      });
    }),
  );

  return { verified, pending };
}

type HistoryCounts = {
  settled: number;
  cancelled: number;
  noShow: number;
  upcoming: number;
  trials: number;
  reviews: number;
};

/**
 * Past and future bookings.
 *
 * Every past booking is run through `resolveBookingOutcome` and its entries are
 * appended, exactly as the settlement job will do in Phase 4. Nothing here
 * writes a balance directly.
 */
async function seedHistory(
  students: SeededStudent[],
  tutors: SeededTutor[],
  subjectIds: Map<string, string>,
  wallets: Wallets,
): Promise<HistoryCounts> {
  const counts: HistoryCounts = { settled: 0, cancelled: 0, noShow: 0, upcoming: 0, trials: 0, reviews: 0 };
  const trialPairs = new Set<string>();
  const takenSlots = new Set<string>();

  /** Keeps the partial unique index on (tutor, start) satisfied for live rows. */
  function reserve(tutorId: string, startAt: Date): boolean {
    const key = `${tutorId}@${startAt.toISOString()}`;
    if (takenSlots.has(key)) return false;
    takenSlots.add(key);
    return true;
  }

  for (const [tutorIndex, tutor] of tutors.entries()) {
    if ((PAYOUT_FIXTURE_EMAILS as readonly string[]).includes(tutor.email)) continue;

    const sessionCount = randInt(0, 9);

    for (let n = 0; n < sessionCount; n += 1) {
      const student = pick(students);
      const durationMinutes = chance(0.4) ? 30 : 60;
      const startAt = onSlotGrid(daysFromNow(-randInt(1, 120), randInt(8, 20), chance(0.5) ? 0 : 30));
      if (!reserve(tutor.id, startAt)) continue;

      const { priceCents } = priceForBooking({
        rates: {
          hourlyCents: tutor.hourlyCents,
          halfHourCents: tutor.halfHourCents,
          promoCents: null,
          promoStartsAt: null,
          promoEndsAt: null,
        },
        durationMinutes,
        isTrial: false,
        now: startAt,
      });

      const bookingId = randomUUID();
      const subjectSlug = tutor.subjectSlugs[0]!;

      await ensureCredits(wallets, student.id, priceCents);

      await db.insert(bookings).values({
        id: bookingId,
        studentId: student.id,
        tutorId: tutor.id,
        subjectId: subjectIds.get(subjectSlug)!,
        isTrial: false,
        startAtUtc: startAt,
        durationMinutes,
        status: 'confirmed',
        priceCents,
        commissionBps: tutor.commissionBps,
        studentTz: student.timezone,
        tutorTz: tutor.timezone,
        livekitRoom: `booking_${bookingId}`,
        createdAt: new Date(startAt.getTime() - randInt(2, 20) * 24 * 60 * 60 * 1000),
      });

      await appendLedger(db, bookingEscrowEntries({ bookingId, studentId: student.id, priceCents }));
      wallets.set(student.id, (wallets.get(student.id) ?? 0) - priceCents);

      // What happened. Mostly fine, occasionally not — enough variety that the
      // admin queues and the ranking metrics have something to chew on.
      const roll = random();
      let attendance: Attendance;
      if (roll < 0.8) {
        attendance = {
          kind: 'session',
          studentSeconds: durationMinutes * 60,
          tutorSeconds: durationMinutes * 60,
          bothPresentSeconds: durationMinutes * 60 - randInt(0, 120),
          tutorWaitedAloneSeconds: randInt(0, 90),
        };
      } else if (roll < 0.88) {
        attendance = {
          kind: 'cancellation',
          by: 'student',
          atUtc: new Date(startAt.getTime() - randInt(1, 60) * 60 * 60 * 1000),
        };
      } else if (roll < 0.93) {
        attendance = {
          kind: 'cancellation',
          by: 'tutor',
          atUtc: new Date(startAt.getTime() - randInt(1, 30) * 60 * 60 * 1000),
        };
      } else if (roll < 0.97) {
        attendance = {
          kind: 'session',
          studentSeconds: 0,
          tutorSeconds: 900,
          bothPresentSeconds: 0,
          tutorWaitedAloneSeconds: 900,
        };
      } else {
        attendance = {
          kind: 'session',
          studentSeconds: 600,
          tutorSeconds: 0,
          bothPresentSeconds: 0,
          tutorWaitedAloneSeconds: 0,
        };
      }

      const forOutcome: BookingForOutcome = {
        id: bookingId,
        studentId: student.id,
        tutorId: tutor.id,
        isTrial: false,
        priceCents,
        commissionBps: tutor.commissionBps,
        startAtUtc: startAt,
        durationMinutes,
      };

      const outcome = resolveBookingOutcome(forOutcome, attendance);
      await appendLedger(db, { entries: outcome.entries, external: false });
      wallets.set(student.id, (wallets.get(student.id) ?? 0) + outcome.refundCents);

      if (outcome.tutorCents > 0) {
        await appendLedger(
          db,
          pendingToAvailableEntries({ bookingId, tutorId: tutor.id, amountCents: outcome.tutorCents }),
        );
      }

      await db
        .update(bookings)
        .set({
          status: outcome.terminalStatus,
          settledAt: startAt,
          cancelledAt: attendance.kind === 'cancellation' ? attendance.atUtc : null,
          cancelledBy: attendance.kind === 'cancellation' ? attendance.by : null,
        })
        .where(sql`id = ${bookingId}`);

      if (outcome.resolution === 'completed') {
        counts.settled += 1;

        // Roughly two in three completed sessions get reviewed.
        if (chance(0.66)) {
          const rating = Math.max(1, Math.min(5, Math.round(tutor.ratingBias + (random() - 0.5))));
          await db.insert(reviews).values({
            bookingId,
            studentId: student.id,
            tutorId: tutor.id,
            rating,
            body: pick(REVIEW_BODIES),
            tutorReply: chance(0.25) ? 'Thank you — see you next week!' : null,
            createdAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
          });
          counts.reviews += 1;
        }
      } else if (outcome.resolution.startsWith('cancelled')) {
        counts.cancelled += 1;
      } else if (outcome.resolution.startsWith('no_show')) {
        counts.noShow += 1;
      }
    }

    // A couple of upcoming confirmed bookings so the calendar is not empty.
    if (tutorIndex % 3 === 0) {
      const student = pick(students);
      const startAt = onSlotGrid(daysFromNow(randInt(1, 20), randInt(9, 19), chance(0.5) ? 0 : 30));
      if (reserve(tutor.id, startAt)) {
        const bookingId = randomUUID();
        const { priceCents } = priceForBooking({
          rates: {
            hourlyCents: tutor.hourlyCents,
            halfHourCents: tutor.halfHourCents,
            promoCents: null,
            promoStartsAt: null,
            promoEndsAt: null,
          },
          durationMinutes: 60,
          isTrial: false,
          now: NOW,
        });

        await ensureCredits(wallets, student.id, priceCents);

        await db.insert(bookings).values({
          id: bookingId,
          studentId: student.id,
          tutorId: tutor.id,
          subjectId: subjectIds.get(tutor.subjectSlugs[0]!)!,
          isTrial: false,
          startAtUtc: startAt,
          durationMinutes: 60,
          status: 'confirmed',
          priceCents,
          commissionBps: tutor.commissionBps,
          studentTz: student.timezone,
          tutorTz: tutor.timezone,
          livekitRoom: `booking_${bookingId}`,
        });

        await appendLedger(db, bookingEscrowEntries({ bookingId, studentId: student.id, priceCents }));
        wallets.set(student.id, (wallets.get(student.id) ?? 0) - priceCents);
        counts.upcoming += 1;
      }
    }

    // A trial request waiting on the tutor. One per student-tutor pair, ever.
    if (tutor.offersTrial && tutorIndex % 4 === 0) {
      const student = pick(students);
      const pairKey = `${student.id}:${tutor.id}`;
      const startAt = onSlotGrid(daysFromNow(randInt(1, 6), randInt(9, 19)));
      if (!trialPairs.has(pairKey) && reserve(tutor.id, startAt)) {
        trialPairs.add(pairKey);
        await db.insert(bookings).values({
          studentId: student.id,
          tutorId: tutor.id,
          subjectId: subjectIds.get(tutor.subjectSlugs[0]!)!,
          isTrial: true,
          startAtUtc: startAt,
          durationMinutes: 15,
          status: 'pending_tutor',
          priceCents: 0,
          commissionBps: tutor.commissionBps,
          escrowCents: 0,
          studentTz: student.timezone,
          tutorTz: tutor.timezone,
        });
        counts.trials += 1;
      }
    }
  }

  // Follows: the retention loop needs some edges to walk.
  const followRows = new Map<string, { studentId: string; tutorId: string }>();
  for (const student of students) {
    for (const tutor of pickMany(tutors, randInt(1, 5))) {
      followRows.set(`${student.id}:${tutor.id}`, { studentId: student.id, tutorId: tutor.id });
    }
  }
  await db.insert(follows).values([...followRows.values()]);

  return counts;
}

/**
 * Force the three payout balances SPEC.md §16 names, then file the payout
 * request that should be sitting in the admin queue.
 */
async function seedPayoutFixtures(
  tutors: SeededTutor[],
  students: SeededStudent[],
  subjectIds: Map<string, string>,
  wallets: Wallets,
): Promise<{ pendingPayoutId: string; amounts: Record<string, number> }> {
  const byEmail = new Map(tutors.map((tutor) => [tutor.email, tutor]));
  const targets = [
    { email: 'payout.pending@tutorly.test', tutorTarget: 10_000 },
    { email: 'payout.ready@tutorly.test', tutorTarget: 10_000 },
    { email: 'payout.short@tutorly.test', tutorTarget: 9_950 },
  ];

  const amounts: Record<string, number> = {};

  for (const target of targets) {
    const tutor = byEmail.get(target.email)!;

    // One completed 60-minute session at the tutor's rate, priced so that the
    // 80% share is exactly the number we want.
    const student = students[1]!;
    const startAt = onSlotGrid(daysFromNow(-2, 14));
    const bookingId = randomUUID();
    const priceCents = tutor.hourlyCents;

    await ensureCredits(wallets, student.id, priceCents);

    await db.insert(bookings).values({
      id: bookingId,
      studentId: student.id,
      tutorId: tutor.id,
      subjectId: subjectIds.get(tutor.subjectSlugs[0]!)!,
      isTrial: false,
      startAtUtc: startAt,
      durationMinutes: 60,
      status: 'confirmed',
      priceCents,
      commissionBps: tutor.commissionBps,
      studentTz: student.timezone,
      tutorTz: tutor.timezone,
      livekitRoom: `booking_${bookingId}`,
    });

    await appendLedger(db, bookingEscrowEntries({ bookingId, studentId: student.id, priceCents }));
    wallets.set(student.id, (wallets.get(student.id) ?? 0) - priceCents);

    const outcome = resolveBookingOutcome(
      {
        id: bookingId,
        studentId: student.id,
        tutorId: tutor.id,
        isTrial: false,
        priceCents,
        commissionBps: tutor.commissionBps,
        startAtUtc: startAt,
        durationMinutes: 60,
      },
      {
        kind: 'session',
        studentSeconds: 3_600,
        tutorSeconds: 3_600,
        bothPresentSeconds: 3_600,
        tutorWaitedAloneSeconds: 0,
      },
    );

    if (outcome.tutorCents !== target.tutorTarget) {
      throw new Error(
        `payout fixture ${target.email}: expected the tutor share to be ${target.tutorTarget}, got ${outcome.tutorCents}. Adjust the fixture hourly rate.`,
      );
    }

    await appendLedger(db, { entries: outcome.entries, external: false });
    await appendLedger(
      db,
      pendingToAvailableEntries({ bookingId, tutorId: tutor.id, amountCents: outcome.tutorCents }),
    );
    await db.update(bookings).set({ status: 'settled', settledAt: startAt }).where(sql`id = ${bookingId}`);

    amounts[target.email] = outcome.tutorCents;
  }

  // The tutor whose request is waiting for an admin.
  const requester = byEmail.get('payout.pending@tutorly.test')!;
  const accountNumber = 'PK36SCBL0000001123456702';

  const [method] = await db
    .insert(payoutMethods)
    .values({
      tutorId: requester.id,
      accountTitle: requester.name,
      bankName: 'Standard Chartered Pakistan',
      country: 'PK',
      accountNumberEnc: encryptSecret(accountNumber),
      swiftEnc: encryptSecret('SCBLPKKX'),
      cnicEnc: encryptSecret('42101-1234567-8'),
      last4: last4(accountNumber),
      isDefault: true,
    })
    .returning({ id: payoutMethods.id });

  const payoutId = randomUUID();
  await db.insert(payouts).values({
    id: payoutId,
    tutorId: requester.id,
    methodId: method!.id,
    amountCents: 10_000,
    feeCents: 0,
    status: 'requested',
    requestedAt: daysFromNow(-1, 9),
  });

  await appendLedger(db, payoutRequestEntries({ payoutId, tutorId: requester.id, amountCents: 10_000 }));

  return { pendingPayoutId: payoutId, amounts };
}

/**
 * Nobody may hold a negative balance. A negative wallet would mean the seed let
 * a student spend credits they never bought, which the booking flow forbids.
 */
async function assertNoNegativeBalances(): Promise<void> {
  const rows = (await db.execute(sql`
    select 'wallet' as kind, user_id::text as id, credits_cents as cents
    from student_wallets where credits_cents < 0
    union all
    select 'tutor_available', user_id::text, available_cents from tutor_profiles where available_cents < 0
    union all
    select 'tutor_pending', user_id::text, pending_cents from tutor_profiles where pending_cents < 0
    union all
    select 'payout_locked', user_id::text, payout_locked_cents from tutor_profiles where payout_locked_cents < 0
    union all
    select 'escrow', id::text, escrow_cents from bookings where escrow_cents < 0
  `)) as unknown as { kind: string; id: string; cents: string }[];

  if (rows.length > 0) {
    const detail = rows.map((row) => `  ${row.kind} ${row.id}: ${row.cents}`).join('\n');
    throw new Error(`seed produced negative balances:\n${detail}`);
  }
}

/**
 * Everything that came in must still be somewhere.
 *
 * The ledger's internal transfers all net to zero, so the sum of every entry
 * equals credits purchased minus payouts actually paid out. If it does not, the
 * seed has invented or destroyed money.
 */
async function assertLedgerConservation(): Promise<void> {
  const [row] = (await db.execute(sql`
    select
      (select coalesce(sum(delta_cents), 0) from ledger_entries)::bigint as ledger_total,
      (select coalesce(sum(credits_cents), 0) from credit_purchases where status = 'paid')::bigint as purchased,
      (select coalesce(sum(amount_cents), 0) from payouts where status = 'paid')::bigint as paid_out
  `)) as unknown as [{ ledger_total: string; purchased: string; paid_out: string }];

  const ledgerTotal = Number(row.ledger_total);
  const expected = Number(row.purchased) - Number(row.paid_out);

  if (ledgerTotal !== expected) {
    throw new Error(
      `ledger does not conserve: entries sum to ${ledgerTotal} but purchases minus payouts is ${expected}`,
    );
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now();
  console.log('Seeding Tutorly ...\n');

  await reset();
  await resetLocalStorage();

  // One hash, reused: every seeded account shares the same password, and bcrypt
  // at cost 12 is deliberately slow.
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const wallets: Wallets = new Map();

  await seedCreditPacks();
  const subjectIds = await seedSubjects();
  await seedAdmin(passwordHash);
  const students = await seedStudents(passwordHash, wallets);
  process.stdout.write('Building intro videos ... ');
  const clips = await buildSeedClips();
  console.log(clips ? `${clips.length} clips transcoded.` : 'skipped (no ffmpeg on this machine).');

  const { verified, pending } = await seedTutors(subjectIds, passwordHash, clips);
  const counts = await seedHistory(students, verified, subjectIds, wallets);
  const payoutFixtures = await seedPayoutFixtures(verified, students, subjectIds, wallets);
  await assertNoNegativeBalances();
  await assertLedgerConservation();

  const [totals] = (await db.execute(sql`
    select
      (select count(*) from users)::int as users,
      (select count(*) from tutor_profiles where status = 'verified')::int as verified_tutors,
      (select count(*) from tutor_profiles where status = 'pending_review')::int as pending_tutors,
      (select count(*) from tutor_profiles where status = 'draft')::int as draft_tutors,
      (select count(*) from tutor_profiles where status = 'rejected')::int as rejected_tutors,
      (select count(*) from credentials)::int as credential_documents,
      (select count(*) from bookings)::int as bookings,
      (select count(*) from reviews)::int as reviews,
      (select count(*) from ledger_entries)::int as ledger_entries,
      (select coalesce(sum(credits_cents), 0) from student_wallets)::bigint as student_credits,
      (select coalesce(sum(available_cents), 0) from tutor_profiles)::bigint as tutor_available,
      (select coalesce(sum(payout_locked_cents), 0) from tutor_profiles)::bigint as payout_locked,
      (select coalesce(balance_cents, 0) from platform_accounts where account = 'platform_revenue')::bigint as platform_revenue,
      (select coalesce(sum(escrow_cents), 0) from bookings)::bigint as escrow
  `)) as unknown as [Record<string, string | number>];

  console.log('World');
  console.log(`  users                    ${totals.users}`);
  console.log(`  verified tutors          ${totals.verified_tutors}`);
  console.log(`  tutors awaiting review   ${totals.pending_tutors}`);
  console.log(`  tutors in draft          ${totals.draft_tutors}`);
  console.log(`  tutors rejected          ${totals.rejected_tutors}`);
  console.log(`  credential documents     ${totals.credential_documents}`);
  console.log(`  students                 ${students.length}`);
  console.log(`  subjects                 ${SUBJECTS.length}`);
  console.log('');
  console.log('Sessions');
  console.log(`  bookings                 ${totals.bookings}`);
  console.log(`  settled                  ${counts.settled}`);
  console.log(`  cancelled                ${counts.cancelled}`);
  console.log(`  no-shows                 ${counts.noShow}`);
  console.log(`  upcoming (confirmed)     ${counts.upcoming}`);
  console.log(`  trial requests pending   ${counts.trials}`);
  console.log(`  reviews                  ${totals.reviews}`);
  console.log('');
  console.log('Money');
  console.log(`  ledger entries           ${totals.ledger_entries}`);
  console.log(`  student credits held     ${formatCents(Number(totals.student_credits))}`);
  console.log(`  in escrow                ${formatCents(Number(totals.escrow))}`);
  console.log(`  tutor available          ${formatCents(Number(totals.tutor_available))}`);
  console.log(`  locked for payout        ${formatCents(Number(totals.payout_locked))}`);
  console.log(`  platform revenue         ${formatCents(Number(totals.platform_revenue))}`);
  console.log('');
  console.log('Payout fixtures (SPEC.md §16)');
  console.log(
    `  payout.pending@tutorly.test  requested ${formatCents(10_000)}, waiting for an admin (payout ${payoutFixtures.pendingPayoutId})`,
  );
  console.log(
    `  payout.ready@tutorly.test    ${formatCents(payoutFixtures.amounts['payout.ready@tutorly.test'] ?? 0)} available — may request`,
  );
  console.log(
    `  payout.short@tutorly.test    ${formatCents(payoutFixtures.amounts['payout.short@tutorly.test'] ?? 0)} available — may not`,
  );
  console.log('');

  const ranking = await recomputeTutorRanking(db);
  console.log('Discovery');
  console.log(`  ${formatRankingRun(ranking)}`);
  console.log(`  intro videos             ${clips ? `${clips.length} transcoded clips shared across tutors` : 'none (ffmpeg not available)'}`);
  console.log('');

  const report = await reconcileLedger(db);
  console.log(formatReconciliationReport(report));
  console.log('');

  console.log('Onboarding fixtures (Phase 1)');
  console.log('  newtutor@tutorly.test        draft, empty profile — walk the whole wizard');
  console.log('  rejected.tutor@tutorly.test  rejected with a reason — fix and resubmit');
  console.log(`  ${totals.pending_tutors} tutors sitting in the admin verification queue with documents`);
  console.log('');

  console.log('Sign in with any of these — the password is the same for all seeded accounts.');
  console.log(`  admin    admin@tutorly.test    ${SEED_PASSWORD}`);
  console.log(`  tutor    tutor@tutorly.test    ${SEED_PASSWORD}`);
  console.log(`  student  student@tutorly.test  ${SEED_PASSWORD}`);
  console.log('');
  console.log(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);

  if (!report.ok) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
