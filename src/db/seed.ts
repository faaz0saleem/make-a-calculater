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
import { eq, sql } from 'drizzle-orm';

import { db } from './client';
import { MAX_TUTOR_CURRICULUM, seedCurriculum } from './curriculum';
import { appendLedger, formatReconciliationReport, reconcileLedger } from './ledger';
import { recomputeAllResponseMedians } from './messages';
import { formatRankingRun, runNightlyRanking } from './ranking';
import { ensureThread } from './trials';
import {
  availabilityRules,
  bookings,
  creditPacks,
  creditPurchases,
  credentials,
  follows,
  availabilityExceptions,
  messages,
  notifications,
  bookingTopics,
  homework,
  payoutMethods,
  payouts,
  recurringSeries,
  topics,
  tutorTopics,
  reviews,
  sessionEvents,
  studentCurriculum,
  studentWallets,
  subjects,
  tutorCurriculum,
  tutorLanguages,
  tutorProfiles,
  tutorRanking,
  tutorSubjects,
  threads,
  users,
  videos,
} from './schema';
import { colourFor, simplePdf, solidPng } from './seed-assets';
import { hashPassword } from '@/lib/auth/password';
import { BOARD_SEEDS } from '@/lib/curriculum/boards';
import type { UserRole } from '@/lib/auth/roles';
import { encryptSecret, last4 } from '@/lib/crypto';
import { formatCents } from '@/lib/money/cents';
import { commissionBpsFor, FIRST_BOOKING_COMMISSION_BPS } from '@/lib/money/commission';
import {
  bookingEscrowEntries,
  creditPurchaseEntries,
  payoutRequestEntries,
  pendingToAvailableEntries,
} from '@/lib/money/ledger';
import { CREDIT_PACKS, type CreditPack } from '@/lib/money/packs';
import { resolveBookingOutcome, type Attendance, type BookingForOutcome } from '@/lib/money/outcomes';
import { deriveHalfHourCents, priceForBooking } from '@/lib/money/pricing';
import { scoreContactIntent, shouldQueueForReview } from '@/lib/messaging/contact-intent';
import { maskContactInfo } from '@/lib/messaging/masking';
import { methodsForCountry } from '@/lib/payments/catalogue';
import { assignHomework, markHomework, submitHomework } from './homework';
import { createSeries, endSeries, runSeriesJobs } from './series';
import { dateInZone } from '@/lib/series/occurrences';
import { DatabaseAvailability } from '@/lib/availability/database';
import { TOPIC_SEEDS } from '@/lib/curriculum/topics';
import { fileReport, recordContactFlag } from './reports';
import { TRIAL_BUFFER_MINUTES } from '@/lib/trials/rules';
import {
  applyExceptions,
  expandWeeklyRules,
  slotsWithin,
  subtractBusy,
  type AvailabilityException as EngineException,
  type BusyInterval,
  type Interval,
  type WeeklyRule,
} from '@/lib/availability';
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

/**
 * Qualifications, each with the subjects it plausibly backs.
 *
 * `supports` exists so the seeded world is coherent: a tutor's documents
 * should usually have something to do with what they teach. Pairing them at
 * random made the verification screen's "worth asking about" flag fire on
 * almost every profile, which is exactly how a real flag becomes wallpaper.
 * A deliberate minority is still mismatched, so the flag has real work to do.
 */
const CREDENTIAL_TEMPLATES = [
  {
    kind: 'degree' as const,
    title: 'BSc Mathematics',
    institution: 'University of Punjab',
    supports: ['math', 'physics', 'programming', 'business', 'test-prep'],
  },
  {
    kind: 'degree' as const,
    title: 'MSc Physics',
    institution: 'Imperial College London',
    supports: ['physics', 'math', 'chemistry'],
  },
  {
    kind: 'degree' as const,
    title: 'BSc Biology',
    institution: 'University of Karachi',
    supports: ['biology', 'chemistry'],
  },
  {
    kind: 'degree' as const,
    title: 'MSc Chemistry',
    institution: 'Aga Khan University',
    supports: ['chemistry', 'biology'],
  },
  {
    kind: 'degree' as const,
    title: 'BBA',
    institution: 'Lahore University of Management Sciences',
    supports: ['business', 'math'],
  },
  {
    kind: 'teaching_licence' as const,
    title: 'QTS Teaching Licence',
    institution: 'UK Department for Education',
    supports: 'any' as const,
  },
  {
    kind: 'certificate' as const,
    title: 'CELTA',
    institution: 'Cambridge Assessment English',
    supports: ['english', 'ielts-toefl', 'languages'],
  },
  {
    kind: 'diploma' as const,
    title: 'Diploma in Computer Science',
    institution: 'NUST',
    supports: ['programming', 'math'],
  },
  {
    kind: 'degree' as const,
    title: 'BA English Literature',
    institution: 'University of Toronto',
    supports: ['english', 'ielts-toefl', 'languages'],
  },
  {
    kind: 'certificate' as const,
    title: 'IELTS Examiner Training',
    institution: 'British Council',
    supports: ['ielts-toefl', 'english'],
  },
  {
    kind: 'certificate' as const,
    title: 'Ijazah in Quran and Tajweed',
    institution: 'Jamia Naeemia',
    supports: ['quran-arabic'],
  },
  {
    kind: 'diploma' as const,
    title: 'ABRSM Grade 8 Piano',
    institution: 'Associated Board of the Royal Schools of Music',
    supports: ['music'],
  },
  {
    kind: 'id' as const,
    title: 'National Identity Card',
    institution: 'NADRA',
    supports: 'any' as const,
  },
];

type CredentialTemplate = (typeof CREDENTIAL_TEMPLATES)[number];

/**
 * The documents one tutor uploads: one qualification per subject they teach,
 * deduplicated, plus an identity card for some of them.
 *
 * `mismatched` deliberately picks documents that back none of their subjects,
 * which is what the admin flag is for.
 */
function credentialsFor(subjectSlugs: string[], mismatched: boolean): CredentialTemplate[] {
  const qualifications = CREDENTIAL_TEMPLATES.filter((template) => template.kind !== 'id');

  if (mismatched || subjectSlugs.length === 0) {
    const unrelated = qualifications.filter(
      (template) =>
        template.supports !== 'any' &&
        !subjectSlugs.some((slug) => (template.supports as readonly string[]).includes(slug)),
    );
    return pickMany(unrelated.length > 0 ? unrelated : qualifications, 1);
  }

  const chosen: CredentialTemplate[] = [];
  for (const slug of subjectSlugs) {
    const supporting = qualifications.filter(
      (template) => template.supports === 'any' || (template.supports as readonly string[]).includes(slug),
    );
    const template = supporting.length > 0 ? pick(supporting) : pick(qualifications);
    if (!chosen.includes(template)) chosen.push(template);
  }

  return chosen;
}

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
  /** A negotiated floor, or null for the tutors who negotiated nothing. */
  commissionBps: number | null;
  offersTrial: boolean;
  trialMinutes: number;
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
      ledger_entries, session_events, reviews, homework,
      booking_topics, bookings, series_topics, recurring_series,
      payouts, payout_methods, credit_purchases, credit_packs,
      follows, messages, threads, notifications, reports, admin_audit,
      contact_flags, user_sanctions,
      availability_exceptions, availability_rules,
      tutor_topics, topics,
      tutor_subjects, tutor_curriculum, student_curriculum, tutor_languages,
      tutor_ranking, credentials, tutor_profiles,
      student_wallets, platform_accounts, videos, subjects,
      board_countries, curriculum_levels, boards,
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
  previewUrl: string;
  heroUrl: string;
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
        previewUrl: publicUrlFor(output.previewKey),
        heroUrl: publicUrlFor(output.heroKey),
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
      firstPurchaseOnly: pack.firstPurchaseOnly ?? false,
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
      // Most students have given a name on a booking form by now. Index 3 has
      // not: their name is still the placeholder signup derived from their
      // email, so the booking form has a real case to ask in.
      nameConfirmedAt: index === 3 ? null : NOW,
      timezone: student.timezone,
      country: LOCALES[index % LOCALES.length]!.country,
      city: LOCALES[index % LOCALES.length]!.city,
      // The question signup cannot defer. Index 4 is under 18 with a guardian
      // already on file; index 5 is under 18 and has not booked yet, so the
      // guardian capture at first booking has somebody to happen to.
      isAdult: index === 4 || index === 5 ? false : true,
      guardianEmail: index === 4 ? 'guardian.four@tutorly.test' : null,
      guardianLinkedAt: index === 4 ? daysFromNow(-20, 9) : null,
      // A number for WhatsApp reminders, given at the reminder step by some.
      phone: index % 3 === 0 ? `+9230012345${String(index).padStart(2, '0')}` : null,
      emailVerified: NOW,
    })),
  );

  await db.insert(studentWallets).values(students.map((student) => ({ userId: student.id })));

  // Credits arrive the only way they ever should: a settled purchase that
  // appends to the ledger.
  for (const [index, student] of students.entries()) {
    const packCount = index === 0 ? 3 : randInt(1, 2);
    for (let purchase = 0; purchase < packCount; purchase += 1) {
      await recordPurchase(wallets, student.id, packChoiceFor(student.id));
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

/**
 * Which rail a purchase went through.
 *
 * Chosen the way the checkout chooses: local methods lead for the student's
 * country, and most people take the one on top. A seed where every purchase is
 * a card would make the dashboard's provider split — and the margin-per-pack
 * numbers that depend on the fee — a constant, and the whole point of the
 * wallets is that a fixed 50c is what makes a $5 pack thin.
 */
/**
 * How many packs each person has bought so far in this run.
 *
 * The $5 pack is `firstPurchaseOnly`, and the database enforces "once ever"
 * with a partial unique index. "First" is stricter than "once", and only the
 * seed can honour it — so it is honoured here rather than left to produce a
 * world where a third of all purchases are the cheap pack.
 */
const purchasesMade = new Map<string, number>();

function packsAvailableTo(userId: string): CreditPack[] {
  const first = (purchasesMade.get(userId) ?? 0) === 0;
  return CREDIT_PACKS.filter((pack) => first || !pack.firstPurchaseOnly);
}

/**
 * What somebody actually reaches for.
 *
 * Most first purchases are the $5 pack — that is what it is for, and a seed
 * where nobody took it would leave the thinnest-margin row off the admin
 * dashboard, which is the one row worth arguing about.
 */
function packChoiceFor(userId: string): CreditPack {
  const offered = packsAvailableTo(userId);
  const taste = offered.find((pack) => pack.firstPurchaseOnly);
  if (taste && chance(0.6)) return taste;
  return pick(offered.filter((pack) => !pack.firstPurchaseOnly));
}

async function providerFor(userId: string): Promise<string> {
  const [row] = (await db.execute(
    sql`select country from users where id = ${userId}::uuid`,
  )) as unknown as { country: string | null }[];

  const offered = methodsForCountry(row?.country ?? null);
  // Four in five take the method the checkout puts first.
  return (chance(0.8) ? offered[0]! : pick(offered)).id;
}

async function recordPurchase(wallets: Wallets, userId: string, pack: CreditPack): Promise<void> {
  const purchaseId = randomUUID();
  const provider = await providerFor(userId);

  await db.insert(creditPurchases).values({
    id: purchaseId,
    userId,
    packId: pack.id,
    paidCents: pack.paidCents,
    creditsCents: pack.creditsCents,
    provider,
    providerRef: `${provider}_${purchaseId.slice(0, 8)}`,
    status: 'paid',
    idempotencyKey: `${provider}:purchase:${purchaseId}`,
    // Snapshotted from the pack, exactly as the live path does, so the unique
    // index has a column to stand on.
    firstPurchaseOnly: pack.firstPurchaseOnly ?? false,
    settledAt: NOW,
  });

  purchasesMade.set(userId, (purchasesMade.get(userId) ?? 0) + 1);

  await appendLedger(db, creditPurchaseEntries({ purchaseId, userId, creditsCents: pack.creditsCents }));
  wallets.set(userId, (wallets.get(userId) ?? 0) + pack.creditsCents);
}

/** Top up until the student can afford `needCents`, smallest sufficient pack first. */
async function ensureCredits(wallets: Wallets, userId: string, needCents: number): Promise<void> {
  while ((wallets.get(userId) ?? 0) < needCents) {
    const shortfall = needCents - (wallets.get(userId) ?? 0);
    const offered = packsAvailableTo(userId);
    const pack =
      offered.find((candidate) => candidate.creditsCents >= shortfall) ??
      offered[offered.length - 1]!;
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
  rulesByTutor: Map<string, WeeklyRule[]>;
  exceptionsByTutor: Map<string, EngineException[]>;
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
      // A handful of early tutors negotiated 15%. Everyone else negotiated
      // nothing, which is null — not 20%, which would be a floor they never
      // agreed to and would cap them at a rate we no longer charge.
      commissionBps: index % 9 === 0 ? 1_500 : null,
      offersTrial: chance(0.6),
      trialMinutes: pick([10, 15, 20]),
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
    // Rates chosen so one 60-minute session at the first-booking rate leaves
    // the tutor exactly $100.00, $100.00 and $99.50. They move whenever the
    // commission does, which is the point of writing the arithmetic down.
    { index: 0, email: 'payout.pending@tutorly.test', name: 'Sadia Mahmood', hourlyCents: 12_820, timezone: 'Asia/Karachi' },
    { index: 1, email: 'payout.ready@tutorly.test', name: 'Daniel Okafor', hourlyCents: 12_820, timezone: 'Africa/Lagos' },
    { index: 2, email: 'payout.short@tutorly.test', name: 'Mei Lin Zhang', hourlyCents: 12_756, timezone: 'Asia/Manila' },
  ];

  for (const fixture of fixtures) {
    const tutor = verified[fixture.index]!;
    tutor.email = fixture.email;
    tutor.name = fixture.name;
    tutor.hourlyCents = fixture.hourlyCents;
    tutor.halfHourCents = deriveHalfHourCents(fixture.hourlyCents);
    tutor.timezone = fixture.timezone;
    tutor.commissionBps = null;
  }

  // A predictable Karachi tutor for the DST scenario and for manual clicking.
  const demoTutor = verified[3]!;
  demoTutor.email = 'tutor@tutorly.test';
  demoTutor.name = 'Hassan Raza';
  demoTutor.timezone = 'Asia/Karachi';
  demoTutor.offersTrial = true;
  // Fixed, because the demo student sits CAIE AS Maths and the two lists have
  // to agree: a curriculum position is always *for* a declared subject.
  demoTutor.subjectSlugs = ['math', 'physics'];

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
        nameConfirmedAt: NOW,
        // A tutor is paid, signs contracts and teaches minors. Under-18 is not
        // an account we create.
        isAdult: true,
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
        previewUrl: clip?.previewUrl ?? null,
        heroUrl: clip?.heroUrl ?? null,
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
        trialMinutes: tutor.trialMinutes,
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
    // Every seventh tutor in the queue uploads something unrelated, so the
    // "worth asking about" flag on the verification screen has real examples.
    const templates = credentialsFor(tutor.subjectSlugs, !isVerified && index % 7 === 0);

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

  const ruleRows = all.flatMap((tutor, index) => {
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
  });

  await db.insert(availabilityRules).values(ruleRows);

  // A few exceptions, so the engine has blocks, a vacation and an extra window
  // to work around rather than a uniform grid.
  const exceptionRows: (typeof availabilityExceptions.$inferInsert)[] = [];

  for (const [index, tutor] of all.entries()) {
    if (statusForIndex(index) === 'draft') continue;

    if (index % 7 === 3) {
      // Vacation: one row covering a range, which is how vacation mode is stored.
      const from = daysFromNow(randInt(3, 20), 0);
      const to = new Date(from.getTime() + randInt(4, 12) * 86_400_000);
      exceptionRows.push({
        tutorId: tutor.id,
        date: from.toISOString().slice(0, 10),
        kind: 'block',
        startUtc: from,
        endUtc: to,
        note: 'Away',
      });
    }

    if (index % 5 === 1) {
      // A single blocked afternoon.
      const from = daysFromNow(randInt(2, 25), 12);
      exceptionRows.push({
        tutorId: tutor.id,
        date: from.toISOString().slice(0, 10),
        kind: 'block',
        startUtc: from,
        endUtc: new Date(from.getTime() + 5 * 3_600_000),
        note: 'Not available',
      });
    }

    if (index % 6 === 2) {
      // An extra window outside the usual weekly pattern.
      const from = daysFromNow(randInt(2, 25), 6);
      exceptionRows.push({
        tutorId: tutor.id,
        date: from.toISOString().slice(0, 10),
        kind: 'extra',
        startUtc: from,
        endUtc: new Date(from.getTime() + 4 * 3_600_000),
        note: 'Extra session time',
      });
    }
  }

  if (exceptionRows.length > 0) {
    await db.insert(availabilityExceptions).values(exceptionRows);
  }

  const rulesByTutor = new Map<string, WeeklyRule[]>();
  for (const row of ruleRows) {
    const list = rulesByTutor.get(row.tutorId) ?? [];
    list.push({
      weekdayLocal: row.weekdayLocal,
      startTimeLocal: row.startTimeLocal,
      endTimeLocal: row.endTimeLocal,
      timezone: row.timezone,
      active: true,
    });
    rulesByTutor.set(row.tutorId, list);
  }

  const exceptionsByTutor = new Map<string, EngineException[]>();
  for (const row of exceptionRows) {
    const list = exceptionsByTutor.get(row.tutorId) ?? [];
    list.push({ kind: row.kind, startUtc: row.startUtc, endUtc: row.endUtc });
    exceptionsByTutor.set(row.tutorId, list);
  }

  return { verified, pending, rulesByTutor, exceptionsByTutor };
}

type HistoryCounts = {
  settled: number;
  cancelled: number;
  noShow: number;
  upcoming: number;
  trials: number;
  trialsTaken: number;
  trialsConverted: number;
  reviews: number;
  awaitingSettlement: number;
};

/**
 * Past and future bookings.
 *
 * Every past booking is run through `resolveBookingOutcome` and its entries are
 * appended, exactly as the settlement job will do in Phase 4. Nothing here
 * writes a balance directly.
 */
/**
 * Slots a tutor was actually free for, over an arbitrary range.
 *
 * The seed places its history through the same engine the product uses, so a
 * seeded session never lands at a time the tutor never published. `freeSlots`
 * itself refuses anything before `now`, which is exactly wrong for backfilling
 * a history, so this composes the pieces directly.
 */
function slotsInRange(
  rules: WeeklyRule[],
  exceptions: EngineException[],
  busy: BusyInterval[],
  bufferMinutes: number,
  durationMinutes: number,
  range: Interval,
) {
  if (rules.length === 0) return [];
  const published = applyExceptions(expandWeeklyRules(rules, range), exceptions, range);
  return slotsWithin(subtractBusy(published, busy, bufferMinutes), durationMinutes);
}

/**
 * The commission a seeded booking carries.
 *
 * Two things this gets right that a plain `tutor.commissionBps` did not.
 *
 * The **retention rule** actually applies: a student's first paid session with
 * a tutor is charged the first-booking rate and every one after the rebooking
 * rate, so the seeded world exercises the rule the product runs on rather than
 * one flat number per tutor.
 *
 * And bookings made **before the repricing** carry the rates that were in force
 * when they were made. A real database has years of them, and a proof that a
 * price change does not reach settled bookings is worth nothing if every
 * booking in the fixture was already at today's rate. `pnpm prove:rates` reads
 * these.
 */
const REPRICED_AT = daysFromNow(-30, 0);
const HISTORIC_FIRST_BOOKING_BPS = 2_000;
const HISTORIC_REBOOKING_BPS = 1_500;

/** Pairs that have already had a paid session, in the order the seed writes them. */
const paidPairs = new Set<string>();

function commissionForSeed(tutor: SeededTutor, studentId: string, startAt: Date): number {
  const key = `${studentId}:${tutor.id}`;
  const returning = paidPairs.has(key);
  paidPairs.add(key);

  const retention =
    startAt < REPRICED_AT
      ? returning
        ? HISTORIC_REBOOKING_BPS
        : HISTORIC_FIRST_BOOKING_BPS
      : commissionBpsFor(returning, null);

  return tutor.commissionBps === null ? retention : Math.min(tutor.commissionBps, retention);
}

// ---------------------------------------------------------------------------
// Curriculum declarations
// ---------------------------------------------------------------------------

/**
 * Subjects a school exam board actually examines.
 *
 * Everything else — IELTS, Quran, music, conversational languages — is real
 * teaching that no board sets a syllabus for, so those positions land on the
 * catch-all board rather than pretending Cambridge examines the oud.
 */
const BOARD_SUBJECT_SLUGS = new Set([
  'math',
  'physics',
  'chemistry',
  'biology',
  'english',
  'business',
  'programming',
]);

/** The boards a country actually uses, best first, never empty. */
function boardsForSeedCountry(country: string | null): string[] {
  const local = BOARD_SEEDS.filter((board) => country && board.countries.includes(country))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((board) => board.id);

  return local.length > 0 ? local : ['caie', 'edexcel'];
}

function levelsOf(boardId: string): string[] {
  return (BOARD_SEEDS.find((board) => board.id === boardId)?.levels ?? []).map((level) => level.id);
}

type Triple = { boardId: string; levelId: string; subjectId: string };

/**
 * Give every seeded tutor and student a plausible curriculum position.
 *
 * "Plausible" means shaped by where they are: a Lahore tutor teaches CAIE,
 * Edexcel, Punjab and Federal, not CBSE and AP. The existing `tutor_subjects`
 * rows decide which subjects appear, so the two lists agree — the same rule the
 * real write path enforces.
 */
async function seedCurriculumDeclarations(
  tutors: SeededTutor[],
  students: SeededStudent[],
  subjectIds: Map<string, string>,
): Promise<{ tutorTriples: number; studentTriples: number }> {
  const countryRows = (await db.execute(
    sql`select id::text as id, country from users`,
  )) as unknown as { id: string; country: string | null }[];
  const countryById = new Map(countryRows.map((row) => [row.id, row.country]));

  const values: (Triple & { tutorId: string })[] = [];

  for (const tutor of tutors) {
    if (tutor.subjectSlugs.length === 0) continue;

    const boardIds = boardsForSeedCountry(countryById.get(tutor.id) ?? null).slice(
      0,
      randInt(1, 2),
    );

    const triples: Triple[] = [];

    for (const slug of tutor.subjectSlugs) {
      const subjectId = subjectIds.get(slug);
      if (!subjectId) continue;

      if (!BOARD_SUBJECT_SLUGS.has(slug)) {
        // No board examines this. Say so rather than inventing one.
        triples.push({ boardId: 'other', levelId: pick(levelsOf('other')), subjectId });
        continue;
      }

      for (const boardId of boardIds) {
        const levels = levelsOf(boardId);
        for (const levelId of pickMany(levels, randInt(2, 3))) {
          triples.push({ boardId, levelId, subjectId });
        }
      }
    }

    // The cap is a real rule, so the seed obeys it rather than working around it.
    for (const triple of triples.slice(0, MAX_TUTOR_CURRICULUM)) {
      values.push({ tutorId: tutor.id, ...triple });
    }
  }

  // The demo tutor teaches a known position, so the demo student matches
  // exactly and the ordering can be demonstrated by hand.
  const demoTutor = tutors.find((tutor) => tutor.email === 'tutor@tutorly.test');
  if (demoTutor) {
    const kept = values.filter((row) => row.tutorId !== demoTutor.id);
    values.length = 0;
    values.push(...kept);

    for (const slug of ['math', 'physics']) {
      const subjectId = subjectIds.get(slug);
      if (!subjectId) continue;
      for (const levelId of ['caie:as-level', 'caie:a2-level', 'caie:igcse']) {
        values.push({ tutorId: demoTutor.id, boardId: 'caie', levelId, subjectId });
      }
    }
  }

  if (values.length > 0) await db.insert(tutorCurriculum).values(values).onConflictDoNothing();

  // Students: one primary position each, plus a second for a few of them.
  const studentValues: {
    studentId: string;
    boardId: string;
    levelId: string;
    subjectId: string;
    isPrimary: boolean;
  }[] = [];

  for (const student of students) {
    // Two thirds land on the launch board, which is where the chapter taxonomy
    // is and where the market this product is aimed at actually sits. The rest
    // are spread as before, so nothing downstream may assume everybody is on
    // Cambridge.
    const boardId = chance(0.65)
      ? 'caie'
      : pick(boardsForSeedCountry(countryById.get(student.id) ?? null));
    const levelId =
      boardId === 'caie'
        ? pick(['caie:igcse', 'caie:o-level', 'caie:as-level', 'caie:a2-level'])
        : pick(levelsOf(boardId));
    const slug = pick([...BOARD_SUBJECT_SLUGS]);
    const subjectId = subjectIds.get(slug);
    if (!subjectId) continue;

    studentValues.push({ studentId: student.id, boardId, levelId, subjectId, isPrimary: true });

    if (chance(0.4)) {
      const second = subjectIds.get(pick([...BOARD_SUBJECT_SLUGS].filter((other) => other !== slug)));
      if (second) {
        studentValues.push({
          studentId: student.id,
          boardId,
          levelId,
          subjectId: second,
          isPrimary: false,
        });
      }
    }
  }

  // The demo student sits CAIE AS Maths — the demo tutor's exact position.
  const demoStudent = students.find((student) => student.email === 'student@tutorly.test');
  if (demoStudent) {
    const kept = studentValues.filter((row) => row.studentId !== demoStudent.id);
    studentValues.length = 0;
    studentValues.push(...kept);

    const math = subjectIds.get('math');
    const physics = subjectIds.get('physics');
    if (math) {
      studentValues.push({
        studentId: demoStudent.id,
        boardId: 'caie',
        levelId: 'caie:as-level',
        subjectId: math,
        isPrimary: true,
      });
    }
    if (physics) {
      studentValues.push({
        studentId: demoStudent.id,
        boardId: 'caie',
        levelId: 'caie:as-level',
        subjectId: physics,
        isPrimary: false,
      });
    }
  }

  if (studentValues.length > 0) {
    await db.insert(studentCurriculum).values(studentValues).onConflictDoNothing();
  }

  const [row] = (await db.execute(sql`
    select
      (select count(*) from tutor_curriculum)::int as tutor_triples,
      (select count(*) from student_curriculum)::int as student_triples,
      (select coalesce(max(per_tutor), 0) from (
        select count(*) as per_tutor from tutor_curriculum group by tutor_id
      ) counts)::int as most_per_tutor
  `)) as unknown as [{ tutor_triples: number; student_triples: number; most_per_tutor: number }];

  if (row.most_per_tutor > MAX_TUTOR_CURRICULUM) {
    throw new Error(
      `A seeded tutor declared ${row.most_per_tutor} curriculum positions; the cap is ${MAX_TUTOR_CURRICULUM}.`,
    );
  }

  // The rule the real write path enforces, checked against what the seed
  // actually wrote: a position is always *for* a subject the tutor claims.
  // The seed inserts directly, so nothing else would catch a fixture that
  // hard-codes a position and forgets the subject behind it.
  const [orphan] = (await db.execute(sql`
    select count(*)::int as total
    from tutor_curriculum tc
    where not exists (
      select 1 from tutor_subjects ts
      where ts.tutor_id = tc.tutor_id and ts.subject_id = tc.subject_id
    )
  `)) as unknown as [{ total: number }];

  if (orphan.total > 0) {
    throw new Error(
      `${orphan.total} seeded curriculum positions name a subject the tutor has not declared.`,
    );
  }

  return { tutorTriples: row.tutor_triples, studentTriples: row.student_triples };
}

async function seedHistory(
  students: SeededStudent[],
  tutors: SeededTutor[],
  subjectIds: Map<string, string>,
  wallets: Wallets,
  rulesByTutor: Map<string, WeeklyRule[]>,
  exceptionsByTutor: Map<string, EngineException[]>,
): Promise<HistoryCounts> {
  const counts: HistoryCounts = {
    settled: 0,
    cancelled: 0,
    noShow: 0,
    upcoming: 0,
    trials: 0,
    trialsTaken: 0,
    trialsConverted: 0,
    reviews: 0,
    awaitingSettlement: 0,
  };
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

    const rules = rulesByTutor.get(tutor.id) ?? [];
    const exceptions = exceptionsByTutor.get(tutor.id) ?? [];
    const bufferMinutes = 10;

    // Bookings this tutor already has, so the engine keeps them apart as the
    // seed fills the calendar in.
    const busy: BusyInterval[] = [];

    /** Takes a real free slot, or null when the tutor has none left. */
    const takeSlot = (range: Interval, durationMinutes: number): Date | null => {
      const candidates = slotsInRange(rules, exceptions, busy, bufferMinutes, durationMinutes, range);
      if (candidates.length === 0) return null;

      const chosen = candidates[Math.floor(random() * candidates.length)]!;
      busy.push({ startUtc: chosen.startUtc, endUtc: chosen.endUtc });
      return chosen.startUtc;
    };

    const pastRange: Interval = { startUtc: daysFromNow(-120, 0), endUtc: daysFromNow(-1, 0) };
    /** Students who have paid this tutor, and when they first did. */
    const paidBefore = new Map<string, Date>();
    const futureRange: Interval = { startUtc: daysFromNow(1, 0), endUtc: daysFromNow(21, 0) };

    const sessionCount = randInt(0, 9);

    for (let n = 0; n < sessionCount; n += 1) {
      const student = pick(students);
      const durationMinutes = chance(0.4) ? 30 : 60;

      const startAt = takeSlot(pastRange, durationMinutes);
      if (!startAt || !reserve(tutor.id, startAt)) continue;

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
      // Decided once, here, and used for both the row and the settlement — the
      // same snapshot the real booking path takes.
      const commissionBps = commissionForSeed(tutor, student.id, startAt);

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
        commissionBps,
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
        commissionBps,
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
          // Stamped the moment the lesson ended, the same as the live path —
          // it is what makes a session reviewable (SPEC.md §9).
          completedAt:
            outcome.resolution === 'completed'
              ? new Date(startAt.getTime() + durationMinutes * 60_000)
              : null,
          cancelledAt: attendance.kind === 'cancellation' ? attendance.atUtc : null,
          cancelledBy: attendance.kind === 'cancellation' ? attendance.by : null,
        })
        .where(sql`id = ${bookingId}`);

      if (outcome.resolution === 'completed') {
        counts.settled += 1;
        // Remembered so a seeded trial can be placed before a session the same
        // student later paid for — which is what `trial_to_paid_rate` counts.
        const earliest = paidBefore.get(student.id);
        if (!earliest || startAt < earliest) paidBefore.set(student.id, startAt);

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

    // Trials that actually happened (SPEC.md §6). Some of these students went on
    // to book a paid session, which is the whole of `trial_to_paid_rate`: without
    // them the term scores every tutor at the neutral midpoint and tells the
    // ranking nothing.
    if (tutor.offersTrial) {
      // Two in three trials led to a paid session; the rest did not. A seed
      // where every trial converts would make the ranking term a constant.
      const paid = [...paidBefore.entries()];
      const converted = paid.length > 0 && chance(0.66) ? paid[randInt(0, paid.length - 1)]! : null;
      const strangers = students.filter((candidate) => !paidBefore.has(candidate.id));
      const trialStudent = converted
        ? students.find((candidate) => candidate.id === converted[0])
        : pick(strangers.length > 0 ? strangers : students);
      const before = converted ? converted[1] : daysFromNow(-2, 0);
      const pairKey = trialStudent ? `${trialStudent.id}:${tutor.id}` : null;

      if (trialStudent && pairKey && !trialPairs.has(pairKey)) {
        const startAt = takeSlot(
          { startUtc: daysFromNow(-120, 0), endUtc: before },
          tutor.trialMinutes + TRIAL_BUFFER_MINUTES,
        );

        if (startAt && reserve(tutor.id, startAt)) {
          trialPairs.add(pairKey);
          const bookingId = randomUUID();

          await db.insert(bookings).values({
            id: bookingId,
            studentId: trialStudent.id,
            tutorId: tutor.id,
            subjectId: subjectIds.get(tutor.subjectSlugs[0]!)!,
            isTrial: true,
            startAtUtc: startAt,
            durationMinutes: tutor.trialMinutes,
            // A trial moves no money, so it settles the moment it is over. The
            // rate is what a first paid booking would have carried.
            status: 'settled',
            priceCents: 0,
            commissionBps: commissionBpsFor(false, tutor.commissionBps),
            escrowCents: 0,
            studentTz: trialStudent.timezone,
            tutorTz: tutor.timezone,
            livekitRoom: `booking_${bookingId}`,
            createdAt: new Date(startAt.getTime() - 2 * 24 * 60 * 60 * 1000),
            completedAt: new Date(startAt.getTime() + tutor.trialMinutes * 60_000),
            settledAt: new Date(startAt.getTime() + tutor.trialMinutes * 60_000),
          });

          counts.trialsTaken += 1;
          if (converted) counts.trialsConverted += 1;
        }
      }
    }

    // A couple of upcoming confirmed bookings so the calendar is not empty.
    if (tutorIndex % 3 === 0) {
      const student = pick(students);
      const startAt = takeSlot(futureRange, 60);
      if (startAt && reserve(tutor.id, startAt)) {
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
          commissionBps: commissionForSeed(tutor, student.id, startAt),
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
      const startAt = takeSlot({ startUtc: daysFromNow(1, 0), endUtc: daysFromNow(7, 0) }, 15);
      if (startAt && !trialPairs.has(pairKey) && reserve(tutor.id, startAt)) {
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
          commissionBps: commissionBpsFor(false, tutor.commissionBps),
          escrowCents: 0,
          studentTz: student.timezone,
          tutorTz: tutor.timezone,
        });
        counts.trials += 1;
      }
    }
  }

  // A session that is live right now, between the two named demo accounts.
  //
  // Without this, opening the classroom means waiting for a booking to come
  // round, and the end-to-end call test has nothing to join. It starts a few
  // minutes ago so the room is open and the clock is already running.
  const liveStudent = students.find((candidate) => candidate.email === 'student@tutorly.test');
  const liveTutor = tutors.find((candidate) => candidate.email === 'tutor@tutorly.test');

  if (liveStudent && liveTutor) {
    const startAt = new Date(Math.floor((NOW.getTime() - 3 * 60_000) / 60_000) * 60_000);

    if (reserve(liveTutor.id, startAt)) {
      const bookingId = randomUUID();
      const { priceCents } = priceForBooking({
        rates: {
          hourlyCents: liveTutor.hourlyCents,
          halfHourCents: liveTutor.halfHourCents,
          promoCents: null,
          promoStartsAt: null,
          promoEndsAt: null,
        },
        durationMinutes: 60,
        isTrial: false,
        now: NOW,
      });

      await ensureCredits(wallets, liveStudent.id, priceCents);

      await db.insert(bookings).values({
        id: bookingId,
        studentId: liveStudent.id,
        tutorId: liveTutor.id,
        subjectId: subjectIds.get(liveTutor.subjectSlugs[0]!)!,
        isTrial: false,
        startAtUtc: startAt,
        durationMinutes: 60,
        status: 'confirmed',
        priceCents,
        commissionBps: commissionForSeed(liveTutor, liveStudent.id, startAt),
        studentTz: liveStudent.timezone,
        tutorTz: liveTutor.timezone,
        livekitRoom: `booking_${bookingId}`,
      });

      await appendLedger(db, bookingEscrowEntries({ bookingId, studentId: liveStudent.id, priceCents }));
      wallets.set(liveStudent.id, (wallets.get(liveStudent.id) ?? 0) - priceCents);
      counts.upcoming += 1;
    }
  }

  // A paid session that finished two hours ago: inside its 24-hour dispute
  // window and not yet settled, so "report a problem" has something to act on
  // and the settlement freeze can be seen working.
  if (liveStudent && liveTutor) {
    const startAt = new Date(Math.floor((NOW.getTime() - 3 * 60 * 60_000) / 60_000) * 60_000);

    if (reserve(liveTutor.id, startAt)) {
      const bookingId = randomUUID();
      const { priceCents } = priceForBooking({
        rates: {
          hourlyCents: liveTutor.hourlyCents,
          halfHourCents: liveTutor.halfHourCents,
          promoCents: null,
          promoStartsAt: null,
          promoEndsAt: null,
        },
        durationMinutes: 60,
        isTrial: false,
        now: NOW,
      });

      await ensureCredits(wallets, liveStudent.id, priceCents);

      await db.insert(bookings).values({
        id: bookingId,
        studentId: liveStudent.id,
        tutorId: liveTutor.id,
        subjectId: subjectIds.get(liveTutor.subjectSlugs[0]!)!,
        isTrial: false,
        startAtUtc: startAt,
        durationMinutes: 60,
        status: 'completed',
        priceCents,
        commissionBps: commissionForSeed(liveTutor, liveStudent.id, startAt),
        studentTz: liveStudent.timezone,
        tutorTz: liveTutor.timezone,
        livekitRoom: `booking_${bookingId}`,
        completedAt: new Date(startAt.getTime() + 60 * 60_000),
      });

      // Real attendance behind the `completed` stamp: without it the row would
      // claim a session that the events do not support.
      const room = `booking_${bookingId}`;
      await db.insert(sessionEvents).values([
        {
          bookingId,
          userId: liveTutor.id,
          event: 'participant_joined',
          atUtc: startAt,
          externalId: `seed:${bookingId}:tutor:join`,
        },
        {
          bookingId,
          userId: liveStudent.id,
          event: 'participant_joined',
          atUtc: new Date(startAt.getTime() + 60_000),
          externalId: `seed:${bookingId}:student:join`,
        },
        {
          bookingId,
          userId: liveStudent.id,
          event: 'participant_left',
          atUtc: new Date(startAt.getTime() + 59 * 60_000),
          externalId: `seed:${bookingId}:student:leave`,
        },
        {
          bookingId,
          userId: liveTutor.id,
          event: 'participant_left',
          atUtc: new Date(startAt.getTime() + 60 * 60_000),
          externalId: `seed:${bookingId}:tutor:leave`,
        },
        {
          bookingId,
          userId: null,
          event: 'room_finished',
          atUtc: new Date(startAt.getTime() + 60 * 60_000),
          externalId: `seed:${bookingId}:room:finished`,
          raw: { room } as never,
        },
      ]);

      await appendLedger(db, bookingEscrowEntries({ bookingId, studentId: liveStudent.id, priceCents }));
      wallets.set(liveStudent.id, (wallets.get(liveStudent.id) ?? 0) - priceCents);
      counts.awaitingSettlement += 1;
    }
  }

  // A free trial the demo student took yesterday with the demo tutor, so the
  // post-trial conversion screen (SPEC.md §6) has something to show without
  // waiting for a trial to happen.
  // Deliberately not the demo tutor: the demo student already has an upcoming
  // session with them, which is exactly the case where nobody needs nudging.
  const conversionTutor = tutors.find(
    (candidate) =>
      candidate.offersTrial &&
      candidate.email !== 'tutor@tutorly.test' &&
      !(PAYOUT_FIXTURE_EMAILS as readonly string[]).includes(candidate.email),
  );

  if (liveStudent && conversionTutor) {
    const startAt = new Date(NOW.getTime() - 26 * 60 * 60_000 - 45 * 60_000);
    const pairKey = `${liveStudent.id}:${conversionTutor.id}`;

    if (!trialPairs.has(pairKey) && reserve(conversionTutor.id, startAt)) {
      trialPairs.add(pairKey);
      const bookingId = randomUUID();
      const finished = new Date(startAt.getTime() + conversionTutor.trialMinutes * 60_000);

      await db.insert(bookings).values({
        id: bookingId,
        studentId: liveStudent.id,
        tutorId: conversionTutor.id,
        subjectId: subjectIds.get(conversionTutor.subjectSlugs[0]!)!,
        isTrial: true,
        startAtUtc: startAt,
        durationMinutes: conversionTutor.trialMinutes,
        status: 'settled',
        priceCents: 0,
        commissionBps: commissionBpsFor(false, conversionTutor.commissionBps),
        escrowCents: 0,
        studentTz: liveStudent.timezone,
        tutorTz: conversionTutor.timezone,
        livekitRoom: `booking_${bookingId}`,
        createdAt: new Date(startAt.getTime() - 6 * 60 * 60_000),
        completedAt: finished,
        settledAt: finished,
      });

      counts.trialsTaken += 1;
    }
  }

  // A session that finished more than a day ago and has not settled yet, so
  // `pnpm settle` has something to do and the settlement test has a booking
  // whose dispute window has closed. It carries no session events: what
  // happened in the room is decided by the webhooks, not by the seed.
  if (liveStudent && liveTutor) {
    const startAt = new Date(NOW.getTime() - 26 * 60 * 60_000);

    if (reserve(liveTutor.id, startAt)) {
      const bookingId = randomUUID();
      const priceCents = liveTutor.hourlyCents;

      await ensureCredits(wallets, liveStudent.id, priceCents);

      await db.insert(bookings).values({
        id: bookingId,
        studentId: liveStudent.id,
        tutorId: liveTutor.id,
        subjectId: subjectIds.get(liveTutor.subjectSlugs[0]!)!,
        isTrial: false,
        startAtUtc: startAt,
        durationMinutes: 60,
        status: 'confirmed',
        priceCents,
        commissionBps: commissionForSeed(liveTutor, liveStudent.id, startAt),
        studentTz: liveStudent.timezone,
        tutorTz: liveTutor.timezone,
        livekitRoom: `booking_${bookingId}`,
      });

      await appendLedger(db, bookingEscrowEntries({ bookingId, studentId: liveStudent.id, priceCents }));
      wallets.set(liveStudent.id, (wallets.get(liveStudent.id) ?? 0) - priceCents);
      counts.awaitingSettlement += 1;
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
 * A few notifications for the demo accounts, so the bell has something in it
 * without waiting for an event to happen (SPEC.md §11).
 */
/**
 * Regulars, and the ones who stopped (SPEC.md §8).
 *
 * The random history above gives most pairs one or two sessions, which is
 * realistic and useless for the disintermediation signal: a pair has to become
 * established before going quiet means anything.
 *
 * So these students belong to one tutor each and book nobody else — which is
 * exactly the shape the signal looks for, and the reason it is deliberate
 * rather than emergent. Two tutors get different ratios, because the number
 * that matters is quiet against still-active and not the raw count: a tutor
 * with a hundred students will always have more quiet pairs than one with five.
 */
async function seedRegularPairs(
  tutors: SeededTutor[],
  subjectIds: Map<string, string>,
  wallets: Wallets,
  rulesByTutor: Map<string, WeeklyRule[]>,
  exceptionsByTutor: Map<string, EngineException[]>,
  passwordHash: string,
): Promise<{ quiet: number; active: number }> {
  const eligible = tutors.filter(
    (tutor) =>
      !(PAYOUT_FIXTURE_EMAILS as readonly string[]).includes(tutor.email) &&
      (rulesByTutor.get(tutor.id) ?? []).length > 0,
  );

  // Four gone and one still here, then one gone and two still here. Read as a
  // ratio those are 80% and 33%, which is the difference the page is for.
  const plan: { tutor: SeededTutor; quiet: number; active: number }[] = [
    { tutor: eligible[0]!, quiet: 4, active: 1 },
    { tutor: eligible[1]!, quiet: 1, active: 2 },
  ].filter((entry) => entry.tutor);

  let quietCount = 0;
  let activeCount = 0;
  let index = 0;

  for (const entry of plan) {
    const rules = rulesByTutor.get(entry.tutor.id) ?? [];
    const exceptions = exceptionsByTutor.get(entry.tutor.id) ?? [];

    // Slots this tutor already gave away, so the seeded regulars sit beside the
    // random history rather than on top of it.
    const existing = (await db.execute(sql`
      select start_at_utc, duration_minutes from bookings where tutor_id = ${entry.tutor.id}::uuid
    `)) as unknown as { start_at_utc: string; duration_minutes: number }[];

    const busy: BusyInterval[] = existing.map((row) => ({
      startUtc: new Date(row.start_at_utc),
      endUtc: new Date(new Date(row.start_at_utc).getTime() + row.duration_minutes * 60_000),
    }));

    for (let n = 0; n < entry.quiet + entry.active; n += 1) {
      const isQuiet = n < entry.quiet;
      index += 1;

      const student: SeededStudent = {
        id: randomUUID(),
        name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        email: `regular${index}@tutorly.test`,
        timezone: entry.tutor.timezone,
      };

      await db.insert(users).values({
        id: student.id,
        email: student.email,
        passwordHash,
        roles: ['student'] as UserRole[],
        name: student.name,
        nameConfirmedAt: NOW,
        timezone: student.timezone,
        country: 'PK',
        isAdult: true,
        emailVerified: NOW,
      });
      await db.insert(studentWallets).values({ userId: student.id });

      // A quiet pair stopped four months ago; an active one had a lesson last
      // week. Three sessions either way, because that is the bar for "this was
      // a real teaching relationship".
      const windows: [number, number][] = isQuiet
        ? [[-155, -140], [-138, -125], [-123, -110]]
        : [[-70, -60], [-45, -35], [-14, -6]];

      for (const [fromDay, toDay] of windows) {
        const candidates = slotsInRange(
          rules,
          exceptions,
          busy,
          10,
          60,
          { startUtc: daysFromNow(fromDay, 0), endUtc: daysFromNow(toDay, 0) },
        );
        if (candidates.length === 0) continue;

        const chosen = candidates[Math.floor(random() * candidates.length)]!;
        busy.push({ startUtc: chosen.startUtc, endUtc: chosen.endUtc });

        const { priceCents } = priceForBooking({
          rates: {
            hourlyCents: entry.tutor.hourlyCents,
            halfHourCents: entry.tutor.halfHourCents,
            promoCents: null,
            promoStartsAt: null,
            promoEndsAt: null,
          },
          durationMinutes: 60,
          isTrial: false,
          now: chosen.startUtc,
        });

        const bookingId = randomUUID();
        const commissionBps = commissionForSeed(entry.tutor, student.id, chosen.startUtc);

        await ensureCredits(wallets, student.id, priceCents);

        await db.insert(bookings).values({
          id: bookingId,
          studentId: student.id,
          tutorId: entry.tutor.id,
          subjectId: subjectIds.get(entry.tutor.subjectSlugs[0]!)!,
          isTrial: false,
          startAtUtc: chosen.startUtc,
          durationMinutes: 60,
          status: 'confirmed',
          priceCents,
          commissionBps,
          studentTz: student.timezone,
          tutorTz: entry.tutor.timezone,
          livekitRoom: `booking_${bookingId}`,
          createdAt: new Date(chosen.startUtc.getTime() - 3 * 24 * 60 * 60 * 1000),
        });

        await appendLedger(db, bookingEscrowEntries({ bookingId, studentId: student.id, priceCents }));
        wallets.set(student.id, (wallets.get(student.id) ?? 0) - priceCents);

        const outcome = resolveBookingOutcome(
          {
            id: bookingId,
            studentId: student.id,
            tutorId: entry.tutor.id,
            isTrial: false,
            priceCents,
            commissionBps,
            startAtUtc: chosen.startUtc,
            durationMinutes: 60,
          },
          {
            kind: 'session',
            studentSeconds: 3_600,
            tutorSeconds: 3_600,
            bothPresentSeconds: 3_540,
            tutorWaitedAloneSeconds: 0,
          },
        );

        await appendLedger(db, { entries: outcome.entries, external: false });
        if (outcome.tutorCents > 0) {
          await appendLedger(
            db,
            pendingToAvailableEntries({
              bookingId,
              tutorId: entry.tutor.id,
              amountCents: outcome.tutorCents,
            }),
          );
        }

        await db
          .update(bookings)
          .set({
            status: outcome.terminalStatus,
            settledAt: chosen.startUtc,
            completedAt: new Date(chosen.startUtc.getTime() + 3_600_000),
          })
          .where(sql`id = ${bookingId}`);
      }

      if (isQuiet) quietCount += 1;
      else activeCount += 1;
    }
  }

  return { quiet: quietCount, active: activeCount };
}

/**
 * Standing arrangements (SPEC.md §5, DECISIONS_NEEDED item 32).
 *
 * Three of them, deliberately at different points in their life, because a
 * series is only interesting once it has run for a while:
 *
 *  - one a week old, so it has an occurrence already charged and a month of
 *    `scheduled` ones ahead;
 *  - one brand new, so the first-session rate is still on its first occurrence;
 *  - one ending, so the seven days' notice is visible on a real row.
 *
 * They go through `createSeries` and `runSeriesJobs` rather than being written
 * by hand, so what the seed produces is what the product produces.
 */
/**
 * The chapter taxonomy (SPEC.md §4).
 *
 * Cambridge only, for now, across the four subjects that carry the demand —
 * see `lib/curriculum/topics.ts` for why that is the honest scope rather than
 * a stub for every board.
 */
async function seedTopics(subjectIds: Map<string, string>): Promise<number> {
  let inserted = 0;

  for (const set of TOPIC_SEEDS) {
    const subjectId = subjectIds.get(set.subjectSlug);
    if (!subjectId) continue;

    const rows = await db
      .insert(topics)
      .values(
        set.topics.map((topic, index) => ({
          boardId: set.boardId,
          levelId: set.levelId,
          subjectId,
          name: topic.name,
          reference: topic.reference,
          sortOrder: index,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: topics.id });

    inserted += rows.length;
  }

  return inserted;
}

/**
 * What sessions were booked for, and what they covered.
 *
 * Attached to settled sessions whose tutor and student share a curriculum
 * position, so the progress view has something real in it. Most attached
 * chapters were covered; some were not, because an hour that gets through
 * everything it planned is not the common case and a seed that pretended
 * otherwise would make the progress bars meaningless.
 */
async function seedBookingTopics(now: Date): Promise<{ attached: number; covered: number }> {
  // The student's own syllabus decides what they can pick, not the tutor's.
  // A student books a chapter because it is on *their* exam; whether the tutor
  // has declared that exact position is the ranking's problem, not this one's.
  const candidates = (await db.execute(sql`
    select b.id::text as booking_id, t.id::text as topic_id, b.completed_at
    from bookings b
    join student_curriculum sc on sc.student_id = b.student_id
    join topics t
      on t.board_id = sc.board_id and t.level_id = sc.level_id and t.subject_id = sc.subject_id
    where b.status in ('settled', 'confirmed', 'scheduled')
    order by b.start_at_utc, t.sort_order
  `)) as unknown as { booking_id: string; topic_id: string; completed_at: string | null }[];

  const byBooking = new Map<string, { topicId: string; completed: boolean }[]>();
  for (const row of candidates) {
    const list = byBooking.get(row.booking_id) ?? [];
    if (list.length >= 3) continue;
    list.push({ topicId: row.topic_id, completed: row.completed_at !== null });
    byBooking.set(row.booking_id, list);
  }

  let attached = 0;
  let covered = 0;

  for (const [bookingId, list] of byBooking) {
    // A student picks one to three chapters, weighted towards fewer.
    const wanted = list.slice(0, chance(0.55) ? 1 : chance(0.6) ? 2 : 3);

    for (const [index, entry] of wanted.entries()) {
      // Only a session that happened can have covered anything. The first
      // chapter usually gets done; the third usually does not.
      const done = entry.completed && (index === 0 ? chance(0.85) : chance(0.45));

      await db
        .insert(bookingTopics)
        .values({
          bookingId,
          topicId: entry.topicId,
          covered: entry.completed ? done : null,
          grasp: done ? pick(['struggling', 'developing', 'secure', 'secure'] as const) : null,
          markedAt: entry.completed ? now : null,
        })
        .onConflictDoNothing();

      attached += 1;
      if (done) covered += 1;
    }
  }

  return { attached, covered };
}

/**
 * Work set between sessions.
 *
 * Goes through `assignHomework`, `submitHomework` and `markHomework` rather
 * than writing rows, so the seeded world is one the real code could have
 * produced — including the rule that marking requires feedback.
 *
 * The distribution is the honest one: most work comes back, some of it does
 * not, and a tutor is usually a session behind on marking. A seed where every
 * piece is set, handed in and marked would hide the three states the pages
 * actually have to render.
 */
async function seedHomework(now: Date): Promise<{ set: number; handedIn: number; marked: number }> {
  const rows = (await db.execute(sql`
    select b.id::text as booking_id, b.tutor_id::text, b.student_id::text, b.start_at_utc,
           -- A chapter that was covered if there is one, otherwise one that was
           -- asked for: work is set against what the session was about either way.
           (select bt.topic_id::text from booking_topics bt
             where bt.booking_id = b.id order by bt.covered desc nulls last, bt.topic_id limit 1) as topic_id,
           (select t.name from booking_topics bt join topics t on t.id = bt.topic_id
             where bt.booking_id = b.id order by bt.covered desc nulls last, bt.topic_id limit 1) as topic_name
    from bookings b
    where b.status = 'settled' and b.completed_at is not null and not b.is_trial
    order by b.start_at_utc desc
    limit 60
  `)) as unknown as {
    booking_id: string;
    tutor_id: string;
    student_id: string;
    start_at_utc: string;
    topic_id: string | null;
    topic_name: string | null;
  }[];

  let set = 0;
  let handedIn = 0;
  let marked = 0;

  for (const row of rows) {
    if (!chance(0.45)) continue;

    const chapter = row.topic_name;
    const assigned = await assignHomework(
      {
        bookingId: row.booking_id,
        tutorId: row.tutor_id,
        title: chapter
          ? pick([
              `Past paper questions on ${chapter}`,
              `${chapter}: the worked examples we did not get to`,
              `Ten questions on ${chapter}, no calculator`,
              `Write up ${chapter} in your own words, one side`,
            ])
          : pick([
              'Past paper questions from last session',
              'The worked examples we did not get to',
              'Ten questions, no calculator',
              'Write up last session in your own words, one side',
            ]),
        body: pick([
          'Send me a photo of your working, not just the answers. The working is the part I can help with.',
          null,
          'If you get stuck for more than ten minutes on one, stop and note where. We will start there.',
        ]),
        topicId: row.topic_id,
        dueAt: new Date(new Date(row.start_at_utc).getTime() + 5 * 86_400_000),
      },
      db,
    );

    if (!assigned.ok) continue;
    set += 1;

    // Handed in, most of the time, a day or two later.
    if (!chance(0.65)) continue;

    const submittedAt = new Date(new Date(row.start_at_utc).getTime() + 2 * 86_400_000);
    const handed = await submitHomework(
      {
        homeworkId: assigned.homeworkId,
        studentId: row.student_id,
        body: pick([
          'Done. I got stuck on the last two — I think I am setting them up wrong.',
          'All finished, working attached.',
          'I did the first eight. The rest I could not start.',
        ]),
      },
      db,
      submittedAt > now ? now : submittedAt,
    );

    if (!handed.ok) continue;
    handedIn += 1;

    // And marked, usually — a tutor being one piece behind is realistic.
    if (!chance(0.7)) continue;

    const outOf = pick([10, 20, 25]);
    const scored = chance(0.75);
    const result = await markHomework(
      {
        homeworkId: assigned.homeworkId,
        tutorId: row.tutor_id,
        mark: scored ? Math.max(1, Math.round(outOf * (0.55 + Math.random() * 0.4))) : null,
        markOutOf: scored ? outOf : null,
        feedback: pick([
          'Good working. Where you lost marks was setting up rather than arithmetic — we will do three of those next time.',
          'This is much better than last week. Keep writing the units down as you go.',
          'You have the method. Slow down on the substitution step, that is where both errors came from.',
        ]),
      },
      db,
      submittedAt > now ? now : new Date(submittedAt.getTime() + 86_400_000),
    );

    if (result.ok) marked += 1;
  }

  return { set, handedIn, marked };
}

/**
 * Chapters a tutor says they are strong on.
 *
 * Half of each tutor's chapters, so the tiebreak has something to break and
 * something to leave alone.
 */
async function seedTutorTopics(): Promise<number> {
  const rows = (await db.execute(sql`
    select tc.tutor_id::text, t.id::text as topic_id
    from tutor_curriculum tc
    join topics t
      on t.board_id = tc.board_id and t.level_id = tc.level_id and t.subject_id = tc.subject_id
    order by tc.tutor_id, t.sort_order
  `)) as unknown as { tutor_id: string; topic_id: string }[];

  const values = rows
    .filter(() => chance(0.5))
    .map((row) => ({ tutorId: row.tutor_id, topicId: row.topic_id }));

  if (values.length === 0) return 0;

  const written = await db
    .insert(tutorTopics)
    .values(values)
    .onConflictDoNothing()
    .returning({ topicId: tutorTopics.topicId });

  return written.length;
}

/** Why somebody books the same hour every week. Written the way people write. */
const SERIES_NOTES = [
  'Mocks are in January and I lose marks on the long questions. I want to go through past papers every week rather than book when I panic.',
  'I am fine in class but I fall behind the week we get something new. A standing slot means I never start a chapter on my own.',
  'My daughter needs the same time every week or it does not happen. Please keep to the chapters we agreed and tell me if she has not done the work.',
] as const;

async function seedRecurringSeries(
  students: SeededStudent[],
  tutors: SeededTutor[],
  wallets: Wallets,
  now: Date,
): Promise<{ created: number; charged: number }> {
  const availability = new DatabaseAvailability(db);
  const candidates = tutors.filter(
    (tutor) => !(PAYOUT_FIXTURE_EMAILS as readonly string[]).includes(tutor.email),
  );

  // Students whose syllabus we actually have chapters for come first, so the
  // seeded world shows a standing slot with its chapters attached. The rest
  // still get one, which is how the empty picker gets exercised too.
  const withChapters = new Set(
    (
      (await db.execute(sql`
        select distinct sc.student_id::text as id
        from student_curriculum sc
        join topics t
          on t.board_id = sc.board_id and t.level_id = sc.level_id and t.subject_id = sc.subject_id
      `)) as unknown as { id: string }[]
    ).map((row) => row.id),
  );

  const ordered = [...students].sort(
    (a, b) => Number(withChapters.has(b.id)) - Number(withChapters.has(a.id)),
  );

  let created = 0;
  let charged = 0;
  let studentIndex = 0;

  for (const [index, tutor] of candidates.entries()) {
    if (created >= 3) break;

    const student = ordered[studentIndex % ordered.length]!;

    // A slot the engine really offers, so the series sits on published hours.
    const free = await availability.freeSlotsFor(
      {
        tutorId: tutor.id,
        durationMinutes: 60,
        fromUtc: daysFromNow(3, 0),
        toUtc: daysFromNow(10, 0),
        limit: 20,
      },
      now,
    );

    if (!free.known || free.value.length === 0) continue;

    const slot = free.value[0]!.startUtc;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tutor.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(slot);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
    if (weekday < 0) continue;

    // The first one started a week ago, so it has history. The rest start now.
    const startedAt = created === 0 ? daysFromNow(-8, 9) : now;

    // What the arrangement is for, from the student's own syllabus. A standing
    // slot is agreed for a reason, and the reason is the thing the tutor reads
    // before every one of these sessions.
    const chapters = (await db.execute(sql`
      select t.id::text as id
      from student_curriculum sc
      join topics t
        on t.board_id = sc.board_id and t.level_id = sc.level_id and t.subject_id = sc.subject_id
      where sc.student_id = ${student.id}::uuid and t.is_active
      order by sc.is_primary desc, t.sort_order
      limit 2
    `)) as unknown as { id: string }[];

    const result = await createSeries(
      {
        studentId: student.id,
        tutorId: tutor.id,
        weekdays: created === 1 ? [weekday, (weekday + 2) % 7] : [weekday],
        startTimeLocal: `${part('hour')}:${part('minute')}:00`,
        durationMinutes: 60,
        startsOn: dateInZone(startedAt, tutor.timezone),
        topicIds: chapters.map((chapter) => chapter.id),
        topicNote: SERIES_NOTES[created % SERIES_NOTES.length]!,
      },
      startedAt,
      db,
    );

    if (!result.ok) {
      studentIndex += 1;
      continue;
    }

    created += 1;
    studentIndex += 1;

    // The week-old one has been through the job, so one session is paid for
    // and one is on its way. Run it at the moment that occurrence's credits
    // fall due, which is what the hourly cron would have done.
    if (created === 1) {
      await ensureCredits(wallets, student.id, result.priceCents * 4);

      const [next] = (await db.execute(sql`
        select start_at_utc from bookings
        where series_id = ${result.seriesId}::uuid and start_at_utc > ${now.toISOString()}::timestamptz
        order by start_at_utc limit 1
      `)) as unknown as { start_at_utc: string }[];

      if (next) {
        const at = new Date(new Date(next.start_at_utc).getTime() - 47 * 3_600_000);
        const money = await runSeriesJobs(at < now ? now : at, db);
        charged += money.charged;
      }
    }

    // The third is on its way out, with the notice period running.
    if (created === 3) {
      await endSeries(
        result.seriesId,
        index % 2 === 0 ? 'student' : 'tutor',
        index % 2 === 0 ? student.id : tutor.id,
        index % 2 === 0 ? 'Exams are over for the year.' : 'My Thursdays have gone.',
        now,
        db,
      );
    }
  }

  return { created, charged };
}

async function seedNotifications(students: SeededStudent[], now: Date): Promise<void> {
  const student = students.find((candidate) => candidate.email === 'student@tutorly.test');
  if (!student) return;

  const rows = (await db.execute(sql`
    select b.id::text as booking_id, u.name as tutor_name, b.tutor_id::text as tutor_id
    from bookings b
    join users u on u.id = b.tutor_id
    where b.student_id = ${student.id}
    order by b.start_at_utc desc
    limit 2
  `)) as unknown as { booking_id: string; tutor_name: string; tutor_id: string }[];

  await db.insert(notifications).values(
    rows.map((row, index) => ({
      userId: student.id,
      kind: index === 0 ? ('new_availability' as const) : ('review_reply' as const),
      title:
        index === 0
          ? `${row.tutor_name} added new times`
          : `${row.tutor_name} replied to your review`,
      body:
        index === 0
          ? 'They have opened up hours you can book.'
          : 'Thank you — see you next week!',
      href: index === 0 ? `/tutors/${row.tutor_id}` : '/dashboard',
      dedupeKey: `seed:${student.id}:${index}`,
      createdAt: new Date(now.getTime() - (index + 1) * 3 * 60 * 60 * 1000),
    })),
  );
}

/**
 * Conversations (SPEC.md §8).
 *
 * Threads only exist where there is a booking, so they are built from the
 * bookings that already exist rather than invented. The tutor's reply latency
 * varies by tutor, which is the whole point: `response_median_seconds` and the
 * "Responds in <1h" badge are computed from these messages, and with every
 * tutor replying at the same speed the ranking term would tell you nothing.
 *
 * One exchange deliberately contains a phone number and an email, so the
 * masking is visible in the product and the moderation queue has something real
 * in it.
 */
async function seedConversations(now: Date): Promise<{ threads: number; messages: number; contactFlags: number }> {
  const pairs = (await db.execute(sql`
    select distinct on (student_id, tutor_id)
      student_id::text as student_id, tutor_id::text as tutor_id, start_at_utc
    from bookings
    order by student_id, tutor_id, start_at_utc desc
    limit 120
  `)) as unknown as { student_id: string; tutor_id: string; start_at_utc: string | Date }[];

  const openers = [
    'Hi! Looking forward to the session. Could we start with quadratic equations?',
    'Hello — I am stuck on question 7 from the past paper. Can we go over it?',
    'Hi, is it alright if we spend the first ten minutes on last week’s homework?',
    'Salaam! My exam is in three weeks. What should I focus on first?',
  ];

  /**
   * Real teaching, full of the digits a naive filter would flag.
   *
   * "Question 15 on page 240" is the most common sentence on a tutoring
   * platform, and a moderation queue that contains it is a queue nobody reads.
   */
  const OFF_PLATFORM_ATTEMPTS = [
    'Could we just do it over whatsapp? My number is +92 300 1234567, or email me at student@example.com',
    'add me on telegram @studyhelp, easier than logging in here every time',
    'my email is ayesha.tutor (at) gmail dot com if you want to send the papers directly',
    'honestly it would be cheaper if we did it directly — no commission that way',
    'can you send it to https://wa.me/923001234567 instead',
  ];

  const MATHS_CHATTER = [
    'For next week: question 15 on page 240, then 18 to 22 on page 241.',
    'If 2x + 3 = 11 then x = 4. Try the same method on Q7, Q8 and Q9.',
    'Past paper 2019, paper 2, question 5 part b — bring your working.',
    'Substitute u = 03 m/s into v = u + at and see what you get.',
    'Chapter 4, section 4.2, problems 21 to 34. Skip 28, it is out of syllabus.',
  ];

  const replies = [
    'Of course. Send over the paper beforehand and I will mark the tricky ones.',
    'Yes — bring your working and we will find where it goes wrong.',
    'That works. I will prepare a couple of extra examples.',
    'Happy to. We will cover the method first, then practise it.',
  ];

  let threadCount = 0;
  let messageCount = 0;
  let flagCount = 0;

  for (const [index, pair] of pairs.entries()) {
    if (!chance(0.55)) continue;

    const threadId = await ensureThread(pair.student_id, pair.tutor_id, db);
    threadCount += 1;

    // A spread of habits: quick repliers, average ones, and one tutor in ten
    // who takes most of a day.
    const replyMinutes = index % 10 === 0 ? randInt(600, 1_400) : index % 3 === 0 ? randInt(5, 45) : randInt(60, 300);

    const started = new Date(
      new Date(pair.start_at_utc).getTime() - randInt(1, 6) * 24 * 60 * 60 * 1000,
    );

    const exchange: { senderId: string; body: string; at: Date }[] = [
      { senderId: pair.student_id, body: pick(openers), at: started },
      {
        senderId: pair.tutor_id,
        body: pick(replies),
        at: new Date(started.getTime() + replyMinutes * 60_000),
      },
    ];

    // Every twelfth pair tries to take it off-platform — and not all the same
    // way, so the moderation queue shows a range of evidence rather than five
    // copies of one sentence. The last one has no number in it at all, which is
    // the case a masking regex cannot see and the scorer can.
    if (index % 12 === 0) {
      exchange.push({
        senderId: pair.student_id,
        // Cycled rather than sampled, so every variant is actually in the
        // queue and the scorer can be judged on a range rather than on luck.
        body: OFF_PLATFORM_ATTEMPTS[(index / 12) % OFF_PLATFORM_ATTEMPTS.length]!,
        at: new Date(started.getTime() + (replyMinutes + 30) * 60_000),
      });
    }

    // And every fifth pair does ordinary maths, full of numbers, which must
    // come out of the scorer at zero. These are in the seed on purpose: the
    // moderation queue is only worth reading if it is not full of these.
    if (index % 5 === 0) {
      exchange.push({
        senderId: pair.tutor_id,
        body: pick(MATHS_CHATTER),
        at: new Date(started.getTime() + (replyMinutes + 45) * 60_000),
      });
    }

    for (const message of exchange) {
      if (message.at > now) continue;
      const masked = maskContactInfo(message.body);
      const intent = scoreContactIntent(message.body);

      const [created] = await db
        .insert(messages)
        .values({
          threadId,
          senderId: message.senderId,
          bodyMasked: masked.masked,
          bodyRaw: message.body,
          redactions: masked.redactions,
          createdAt: message.at,
        })
        .returning({ id: messages.id });

      // Exactly what the live path does: write a row for a person to read, and
      // nothing else. No sanction is seeded, because none would be issued.
      if (shouldQueueForReview(intent)) {
        await recordContactFlag(
          { messageId: created!.id, threadId, senderId: message.senderId, intent },
          db,
        );
        flagCount += 1;
      }

      messageCount += 1;
    }

    const last = exchange[exchange.length - 1]!;
    await db.update(threads).set({ lastMessageAt: last.at }).where(eq(threads.id, threadId));
  }

  // The medians the badge and the ranking term both read.
  await recomputeAllResponseMedians(now, db);

  return { threads: threadCount, messages: messageCount, contactFlags: flagCount };
}

/**
 * A handful of reports for the queue.
 *
 * No sanctions are seeded, deliberately. Every notice in this product is issued
 * by a named admin who has read the thing, and a seed that manufactured one
 * would be seeding a decision nobody made.
 */
async function seedReports(
  students: { id: string }[],
  tutors: { id: string }[],
): Promise<number> {
  const cases: { reporterIndex: number; targetIndex: number; reason: string; body: string }[] = [
    {
      reporterIndex: 0,
      targetIndex: 0,
      reason: 'Asked me to pay or message off Tutorly',
      body: 'He said it would be cheaper if I paid him directly and sent me a number.',
    },
    {
      reporterIndex: 1,
      targetIndex: 1,
      reason: 'Did not teach what was booked',
      body: 'I booked A-level chemistry and we spent the hour on GCSE material.',
    },
    {
      reporterIndex: 2,
      targetIndex: 2,
      reason: 'Not who they say they are',
      body: 'The person on the call was not the person in the profile photo.',
    },
  ];

  let filed = 0;

  for (const entry of cases) {
    const reporter = students[entry.reporterIndex];
    const target = tutors[entry.targetIndex];
    if (!reporter || !target) continue;

    const result = await fileReport({
      reporterId: reporter.id,
      targetType: 'tutor_profile',
      targetId: target.id,
      reason: entry.reason,
      body: entry.body,
    });

    if (result.ok) filed += 1;
  }

  return filed;
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
  rulesByTutor: Map<string, WeeklyRule[]>,
  exceptionsByTutor: Map<string, EngineException[]>,
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
    const startAt =
      slotsInRange(
        rulesByTutor.get(tutor.id) ?? [],
        exceptionsByTutor.get(tutor.id) ?? [],
        [],
        10,
        60,
        { startUtc: daysFromNow(-30, 0), endUtc: daysFromNow(-1, 0) },
      )[0]?.startUtc ?? onSlotGrid(daysFromNow(-2, 14));
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
      // Pinned rather than inherited: this fixture's whole job is to land the
      // balance on an exact number, so it states the rate it was priced at.
      commissionBps: FIRST_BOOKING_COMMISSION_BPS,
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
        commissionBps: FIRST_BOOKING_COMMISSION_BPS,
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
    await db
      .update(bookings)
      .set({
        status: 'settled',
        settledAt: startAt,
        completedAt: new Date(startAt.getTime() + 60 * 60_000),
      })
      .where(sql`id = ${bookingId}`);

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

  // The tutor who *can* request already has somewhere to be paid, and it is a
  // mobile wallet rather than a bank. For a large share of Pakistani tutors that
  // is the only account they have, so the fixtures have to cover it.
  const ready = byEmail.get('payout.ready@tutorly.test')!;
  const walletNumber = '03001234567';

  await db.insert(payoutMethods).values({
    tutorId: ready.id,
    kind: 'mobile_wallet',
    accountTitle: ready.name,
    walletProvider: 'easypaisa',
    country: 'PK',
    accountNumberEnc: encryptSecret(walletNumber),
    last4: last4(walletNumber),
    isDefault: true,
  });

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
  await seedCurriculum(db);
  await seedAdmin(passwordHash);
  const students = await seedStudents(passwordHash, wallets);
  process.stdout.write('Building intro videos ... ');
  const clips = await buildSeedClips();
  console.log(clips ? `${clips.length} clips transcoded.` : 'skipped (no ffmpeg on this machine).');

  const { verified, pending, rulesByTutor, exceptionsByTutor } = await seedTutors(
    subjectIds,
    passwordHash,
    clips,
  );
  const counts = await seedHistory(
    students,
    verified,
    subjectIds,
    wallets,
    rulesByTutor,
    exceptionsByTutor,
  );
  const regulars = await seedRegularPairs(
    verified,
    subjectIds,
    wallets,
    rulesByTutor,
    exceptionsByTutor,
    passwordHash,
  );
  const topicCount = await seedTopics(subjectIds);
  const payoutFixtures = await seedPayoutFixtures(
    verified,
    students,
    subjectIds,
    wallets,
    rulesByTutor,
    exceptionsByTutor,
  );
  // A few students left with money to spend, so booking can be tried by hand —
  // and so the double-booking proof has students who can afford the same slot.
  // Through a real purchase, so the ledger stays the source of truth.
  const spenders = [students.find((s) => s.email === 'student@tutorly.test'), ...students.slice(0, 8)]
    .filter((student): student is SeededStudent => Boolean(student))
    .filter((student, index, all) => all.findIndex((other) => other.id === student.id) === index)
    .slice(0, 6);

  for (const student of spenders) {
    await ensureCredits(wallets, student.id, 20_000);
  }

  const curriculum = await seedCurriculumDeclarations([...verified, ...pending], students, subjectIds);

  // After the declarations, because all three of these join through them: a
  // chapter is only offered to somebody whose declared position it belongs to,
  // and a standing arrangement is agreed for chapters like anything else.
  const series = await seedRecurringSeries(students, verified, wallets, NOW);
  const covered = await seedBookingTopics(NOW);
  const strengths = await seedTutorTopics();
  const work = await seedHomework(NOW);

  const conversations = await seedConversations(NOW);
  const reportCount = await seedReports(students, verified);
  await seedNotifications(students, NOW);

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
  console.log(`  boards                   ${BOARD_SEEDS.length}`);
  console.log(`  tutor curriculum         ${curriculum.tutorTriples} positions`);
  console.log(`  student curriculum       ${curriculum.studentTriples} positions`);
  console.log('');
  console.log('Sessions');
  console.log(`  bookings                 ${totals.bookings}`);
  console.log(`  settled                  ${counts.settled}`);
  console.log(`  cancelled                ${counts.cancelled}`);
  console.log(`  no-shows                 ${counts.noShow}`);
  console.log(`  upcoming (confirmed)     ${counts.upcoming}`);
  console.log(`  trial requests pending   ${counts.trials}`);
  console.log(`  trials taken             ${counts.trialsTaken} (${counts.trialsConverted} converted to paid)`);
  console.log(`  conversations            ${conversations.threads} threads, ${conversations.messages} messages`);
  console.log(
    `  moderation queue         ${conversations.contactFlags} contact flags, ${reportCount} open reports, no sanctions`,
  );
  console.log(
    `  established pairs        ${regulars.quiet} that went quiet, ${regulars.active} still booking`,
  );
  console.log(
    `  standing arrangements    ${series.created} series, ${series.charged} occurrence(s) already charged`,
  );
  console.log(
    `  chapters                 ${topicCount} seeded · ${covered.attached} attached to sessions · ${covered.covered} marked covered · ${strengths} tutor strengths`,
  );
  console.log(
    `  homework                 ${work.set} set · ${work.handedIn} handed in · ${work.marked} marked`,
  );
  console.log(`  awaiting settlement      ${counts.awaitingSettlement}`);
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

  const ranking = await runNightlyRanking(db);
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
