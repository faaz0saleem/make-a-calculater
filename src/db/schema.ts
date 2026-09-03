/**
 * The full Tutorly schema (SPEC.md §12).
 *
 * Conventions:
 *  - Money is integer cents. Column names end in `_cents`. Per-row amounts are
 *    `integer`; balances and lifetime totals are `bigint` because they only grow.
 *  - Every timestamp is `timestamptz` and is stored in UTC. Rendering into a
 *    user's IANA timezone happens at the edge, never in the database.
 *  - `drizzle.config.ts` sets `casing: 'snake_case'`, so `hourlyCents` in TypeScript
 *    is `hourly_cents` in Postgres. Do not hand-write snake_case names here.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { BOOKING_STATUSES } from '@/lib/bookings/status';
import { LEDGER_ACCOUNTS } from '@/lib/money/ledger';
import { PAYOUT_STATUSES } from '@/lib/money/payouts';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', ['student', 'tutor', 'admin']);

export const tutorStatusEnum = pgEnum('tutor_status', [
  'draft',
  'pending_review',
  'verified',
  'rejected',
  'suspended',
]);

export const videoStatusEnum = pgEnum('video_status', ['uploading', 'processing', 'ready', 'failed']);

export const credentialKindEnum = pgEnum('credential_kind', [
  'degree',
  'diploma',
  'certificate',
  'teaching_licence',
  'id',
]);

export const credentialStatusEnum = pgEnum('credential_status', ['pending', 'approved', 'rejected']);

export const languageProficiencyEnum = pgEnum('language_proficiency', [
  'basic',
  'conversational',
  'fluent',
  'native',
]);

export const subjectLevelEnum = pgEnum('subject_level', [
  'beginner',
  'intermediate',
  'advanced',
  'exam_prep',
]);

export const availabilityExceptionKindEnum = pgEnum('availability_exception_kind', ['block', 'extra']);

export const bookingStatusEnum = pgEnum('booking_status', BOOKING_STATUSES);

export const partyEnum = pgEnum('party', ['student', 'tutor', 'admin', 'system']);

export const sessionEventEnum = pgEnum('session_event', [
  'room_started',
  'participant_joined',
  'participant_left',
  'room_finished',
]);

export const ledgerAccountEnum = pgEnum('ledger_account', LEDGER_ACCOUNTS);

export const purchaseStatusEnum = pgEnum('purchase_status', [
  'pending',
  'paid',
  'failed',
  'refunded',
]);

export const payoutStatusEnum = pgEnum('payout_status', PAYOUT_STATUSES);

export const reportTargetEnum = pgEnum('report_target', [
  'user',
  'tutor_profile',
  'booking',
  'review',
  'message',
]);

export const reportStatusEnum = pgEnum('report_status', ['open', 'reviewing', 'resolved', 'dismissed']);

// ---------------------------------------------------------------------------
// Users and auth
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: varchar({ length: 255 }).notNull(),
    /** Null for accounts that only ever signed in with Google. */
    passwordHash: text(),
    /** A set, not a single column: one account can be both a student and a tutor. */
    roles: userRoleEnum().array().notNull().default(sql`ARRAY['student']::user_role[]`),
    name: varchar({ length: 120 }).notNull(),
    /**
     * Named for the Auth.js adapter, stored as `avatar_url` per SPEC.md §12.
     * The adapter type-checks the TypeScript key, Postgres sees the spec's name.
     */
    image: text('avatar_url'),
    /** IANA identifier, e.g. `Asia/Karachi`. Never an offset. */
    timezone: varchar({ length: 64 }).notNull().default('UTC'),
    /** ISO 3166-1 alpha-2. */
    country: varchar({ length: 2 }),
    city: varchar({ length: 120 }),
    /** Auth.js calls this `emailVerified`; the column is `email_verified_at`. */
    emailVerified: timestamp('email_verified_at', { withTimezone: true }),
    suspendedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_lower_key').on(sql`lower(${table.email})`),
    index('users_roles_idx').using('gin', table.roles),
  ],
);

/** Auth.js OAuth links (Google). */
export const accounts = pgTable(
  'accounts',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar({ length: 32 }).notNull(),
    provider: varchar({ length: 64 }).notNull(),
    providerAccountId: varchar({ length: 255 }).notNull(),
    // Auth.js reads these keys verbatim, so they are snake_case in TypeScript too.
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: varchar({ length: 64 }),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

/** Auth.js database sessions. Present for the adapter; the app uses JWTs. */
export const sessions = pgTable('sessions', {
  sessionToken: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp({ withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

// ---------------------------------------------------------------------------
// Wallets and tutor profiles
// ---------------------------------------------------------------------------

export const studentWallets = pgTable('student_wallets', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Materialised sum of the `student_credits` ledger account. */
  creditsCents: bigint({ mode: 'number' }).notNull().default(0),
  lifetimePurchasedCents: bigint({ mode: 'number' }).notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Intro videos (SPEC.md §3 step 4).
 *
 * The only video Tutorly stores. A 30-90 second marketing clip per tutor —
 * teaching itself is live, so there are no recorded lessons here and no course
 * content.
 */
export const videos = pgTable('videos', {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** The tutor's original upload, kept so a failed transcode can be retried. */
  sourceKey: text(),
  /** HLS master playlist. Played by the profile page hero. */
  hlsUrl: text(),
  /** Short muted MP4. Played by the feed card on hover, so no player library. */
  previewUrl: text(),
  /** The candidate the tutor picked. Becomes the card and hero poster. */
  thumbnailUrl: text(),
  /** All three candidates, kept so the tutor can change their mind. */
  thumbnailCandidates: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  durationS: integer(),
  width: integer(),
  height: integer(),
  status: videoStatusEnum().notNull().default('uploading'),
  /** Why processing failed, shown to the tutor verbatim. */
  error: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const tutorProfiles = pgTable(
  'tutor_profiles',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: tutorStatusEnum().notNull().default('draft'),
    headline: varchar({ length: 80 }),
    bio: text(),
    introVideoId: uuid().references(() => videos.id, { onDelete: 'set null' }),

    // Rates. Snapshotted onto each booking, so changing these never reprices one.
    hourlyCents: integer().notNull().default(2_500),
    halfHourCents: integer().notNull().default(1_250),
    promoCents: integer(),
    promoStartsAt: timestamp({ withTimezone: true }),
    promoEndsAt: timestamp({ withTimezone: true }),

    /** Platform take rate in basis points. 2000 = 20%. */
    commissionBps: integer().notNull().default(2_000),

    // Trials (SPEC.md §6).
    offersTrial: boolean().notNull().default(false),
    trialMinutes: smallint().notNull().default(15),
    maxTrialsPerWeek: smallint().notNull().default(5),

    // Scheduling knobs (SPEC.md §5).
    bufferMinutes: smallint().notNull().default(10),
    maxSessionsPerDay: smallint().notNull().default(8),
    bookingHorizonDays: smallint().notNull().default(30),
    minLeadMinutes: smallint().notNull().default(60),

    // Materialised sums of the tutor's ledger accounts.
    pendingCents: bigint({ mode: 'number' }).notNull().default(0),
    availableCents: bigint({ mode: 'number' }).notNull().default(0),
    payoutLockedCents: bigint({ mode: 'number' }).notNull().default(0),
    lifetimeEarnedCents: bigint({ mode: 'number' }).notNull().default(0),

    verifiedAt: timestamp({ withTimezone: true }),
    verifiedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp({ withTimezone: true }),
    rejectionReason: text(),
    strikes: smallint().notNull().default(0),

    /** Median first-reply time in seconds. Feeds the "Responds in <1h" badge. */
    responseMedianSeconds: integer(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tutor_profiles_status_idx').on(table.status),
    index('tutor_profiles_hourly_idx').on(table.hourlyCents),
  ],
);

export const credentials = pgTable(
  'credentials',
  {
    id: uuid().primaryKey().defaultRandom(),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: credentialKindEnum().notNull(),
    title: varchar({ length: 200 }).notNull(),
    institution: varchar({ length: 200 }).notNull(),
    year: smallint(),
    /**
     * Object key in the PRIVATE R2 bucket. Never rendered to a browser directly —
     * admin views it through a 60-second signed URL.
     */
    fileKey: text().notNull(),
    status: credentialStatusEnum().notNull().default('pending'),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp({ withTimezone: true }),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('credentials_tutor_idx').on(table.tutorId, table.status)],
);

/**
 * Languages a tutor teaches in (SPEC.md §3 step 2).
 *
 * A table rather than a column on `tutor_profiles`, because SPEC.md §4 lists
 * language as a search filter and a join is cheaper to index than a jsonb probe.
 */
export const tutorLanguages = pgTable(
  'tutor_languages',
  {
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** ISO 639-1, e.g. `en`, `ur`, `ar`. */
    languageCode: varchar({ length: 8 }).notNull(),
    proficiency: languageProficiencyEnum().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tutorId, table.languageCode] }),
    index('tutor_languages_code_idx').on(table.languageCode),
  ],
);

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export const subjects = pgTable(
  'subjects',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: varchar({ length: 64 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    /** Self-reference; the constraint is declared below to avoid a circular type. */
    parentId: uuid(),
    sortOrder: smallint().notNull().default(0),
  },
  (table) => [
    uniqueIndex('subjects_slug_key').on(table.slug),
    foreignKey({
      name: 'subjects_parent_id_fk',
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete('set null'),
  ],
);

export const tutorSubjects = pgTable(
  'tutor_subjects',
  {
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    level: subjectLevelEnum().notNull(),
    yearsExperience: smallint().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.tutorId, table.subjectId] }),
    index('tutor_subjects_subject_idx').on(table.subjectId),
  ],
);

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 0 = Sunday, matching Postgres `extract(dow ...)`. UTC weekday. */
    weekday: smallint().notNull(),
    startTimeUtc: time().notNull(),
    endTimeUtc: time().notNull(),
    /**
     * The same window as the tutor entered it. Kept alongside the UTC copy so a
     * tutor in a DST-observing zone still starts at 9am local all year — see
     * DECISIONS_NEEDED.md.
     */
    weekdayLocal: smallint().notNull(),
    startTimeLocal: time().notNull(),
    endTimeLocal: time().notNull(),
    timezone: varchar({ length: 64 }).notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('availability_rules_tutor_idx').on(table.tutorId, table.weekday)],
);

export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date().notNull(),
    kind: availabilityExceptionKindEnum().notNull(),
    startUtc: timestamp({ withTimezone: true }).notNull(),
    endUtc: timestamp({ withTimezone: true }).notNull(),
    note: varchar({ length: 200 }),
  },
  (table) => [index('availability_exceptions_tutor_idx').on(table.tutorId, table.date)],
);

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export const bookings = pgTable(
  'bookings',
  {
    id: uuid().primaryKey().defaultRandom(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    subjectId: uuid().references(() => subjects.id, { onDelete: 'set null' }),
    isTrial: boolean().notNull().default(false),

    startAtUtc: timestamp({ withTimezone: true }).notNull(),
    durationMinutes: smallint().notNull(),
    status: bookingStatusEnum().notNull(),

    /** Snapshots taken when the booking was created. Never recomputed. */
    priceCents: integer().notNull().default(0),
    commissionBps: integer().notNull().default(2_000),
    escrowCents: integer().notNull().default(0),

    /** The timezones both parties saw at booking time, for support conversations. */
    studentTz: varchar({ length: 64 }).notNull(),
    tutorTz: varchar({ length: 64 }).notNull(),

    livekitRoom: varchar({ length: 100 }),

    rescheduleCount: smallint().notNull().default(0),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelledBy: partyEnum(),
    settledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * SPEC.md §5: double-booking is impossible at the database level. A tutor can
     * hold exactly one live booking per start time; cancelled and finished rows
     * drop out of the index so the slot frees up.
     */
    uniqueIndex('booking_no_overlap')
      .on(table.tutorId, table.startAtUtc)
      .where(sql`status in ('pending_tutor', 'confirmed', 'in_progress')`),
    /** SPEC.md §6: one free trial per student-tutor pair, for life. */
    uniqueIndex('one_trial_per_pair')
      .on(table.studentId, table.tutorId)
      .where(sql`is_trial = true`),
    index('bookings_student_idx').on(table.studentId, table.startAtUtc),
    index('bookings_tutor_idx').on(table.tutorId, table.startAtUtc),
    index('bookings_status_idx').on(table.status, table.startAtUtc),
  ],
);

export const sessionEvents = pgTable(
  'session_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    event: sessionEventEnum().notNull(),
    atUtc: timestamp({ withTimezone: true }).notNull(),
    /** The raw LiveKit webhook body, kept verbatim for disputes. */
    raw: jsonb().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [index('session_events_booking_idx').on(table.bookingId, table.atUtc)],
);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Append-only. Every balance in the product is the sum of these rows; the
 * materialised columns elsewhere are a cache that `pnpm reconcile` verifies.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    bookingId: uuid().references(() => bookings.id, { onDelete: 'restrict' }),
    payoutId: uuid(),
    purchaseId: uuid(),
    account: ledgerAccountEnum().notNull(),
    /** Null only for `platform_revenue`, which belongs to the business. */
    ownerId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    deltaCents: bigint({ mode: 'number' }).notNull(),
    reason: varchar({ length: 100 }).notNull(),
    idempotencyKey: varchar({ length: 200 }).notNull(),
  },
  (table) => [
    uniqueIndex('ledger_entries_idempotency_key').on(table.idempotencyKey),
    index('ledger_entries_account_owner_idx').on(table.account, table.ownerId),
    index('ledger_entries_booking_idx').on(table.bookingId),
  ],
);

/** Materialised balances that belong to the business rather than to a user. */
export const platformAccounts = pgTable('platform_accounts', {
  account: ledgerAccountEnum().primaryKey(),
  balanceCents: bigint({ mode: 'number' }).notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Editable in admin; seeded from `CREDIT_PACKS` in src/lib/money/packs.ts. */
export const creditPacks = pgTable('credit_packs', {
  id: varchar({ length: 32 }).primaryKey(),
  name: varchar({ length: 64 }).notNull(),
  paidCents: integer().notNull(),
  creditsCents: integer().notNull(),
  sortOrder: smallint().notNull().default(0),
  active: boolean().notNull().default(true),
});

export const creditPurchases = pgTable(
  'credit_purchases',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    packId: varchar({ length: 32 })
      .notNull()
      .references(() => creditPacks.id, { onDelete: 'restrict' }),
    paidCents: integer().notNull(),
    creditsCents: integer().notNull(),
    /** `mock`, `paddle`, `lemonsqueezy`, ... — never hard-coded in logic. */
    provider: varchar({ length: 32 }).notNull(),
    providerRef: varchar({ length: 200 }),
    status: purchaseStatusEnum().notNull().default('pending'),
    /** Webhooks arrive twice. This index is what makes the second one a no-op. */
    idempotencyKey: varchar({ length: 200 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('credit_purchases_idempotency_key').on(table.idempotencyKey),
    index('credit_purchases_user_idx').on(table.userId, table.createdAt),
  ],
);

export const payoutMethods = pgTable(
  'payout_methods',
  {
    id: uuid().primaryKey().defaultRandom(),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountTitle: varchar({ length: 200 }).notNull(),
    bankName: varchar({ length: 200 }).notNull(),
    country: varchar({ length: 2 }).notNull(),
    /** AES-256-GCM ciphertext. See src/lib/crypto.ts. Never logged, never returned. */
    accountNumberEnc: text().notNull(),
    swiftEnc: text(),
    /** Optional, Pakistan-domiciled tutors only. */
    cnicEnc: text(),
    /** The only part of the account number the UI is allowed to show. */
    last4: varchar({ length: 4 }).notNull(),
    isDefault: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('payout_methods_tutor_idx').on(table.tutorId)],
);

export const payouts = pgTable(
  'payouts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    methodId: uuid().references(() => payoutMethods.id, { onDelete: 'set null' }),
    amountCents: integer().notNull(),
    feeCents: integer().notNull().default(0),
    status: payoutStatusEnum().notNull().default('requested'),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp({ withTimezone: true }),
    /** Bank reference number, shown to the tutor in earnings history. */
    paidRef: varchar({ length: 120 }),
    rejectReason: text(),
  },
  (table) => [index('payouts_status_idx').on(table.status, table.requestedAt)],
);

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export const reviews = pgTable(
  'reviews',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: smallint().notNull(),
    body: text(),
    tutorReply: text(),
    hiddenAt: timestamp({ withTimezone: true }),
    hiddenReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reviews_booking_key').on(table.bookingId),
    index('reviews_tutor_idx').on(table.tutorId, table.createdAt),
  ],
);

export const follows = pgTable(
  'follows',
  {
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.studentId, table.tutorId] }),
    index('follows_tutor_idx').on(table.tutorId),
  ],
);

export const threads = pgTable(
  'threads',
  {
    id: uuid().primaryKey().defaultRandom(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastMessageAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('threads_pair_key').on(table.studentId, table.tutorId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    threadId: uuid()
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    senderId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** What everyone sees: emails, phone numbers and handles already redacted. */
    bodyMasked: text().notNull(),
    /** Moderation only. Never selected by a route a normal user can reach. */
    bodyRaw: text().notNull(),
    attachments: jsonb().$type<{ url: string; name: string; bytes: number }[]>().notNull().default(sql`'[]'::jsonb`),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('messages_thread_idx').on(table.threadId, table.createdAt)],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid().primaryKey().defaultRandom(),
    reporterId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: reportTargetEnum().notNull(),
    targetId: uuid().notNull(),
    reason: varchar({ length: 120 }).notNull(),
    body: text(),
    status: reportStatusEnum().notNull().default('open'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('reports_status_idx').on(table.status, table.createdAt)],
);

/** SPEC.md §10: every money-moving admin action writes a row here. No exceptions. */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: uuid().primaryKey().defaultRandom(),
    actorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: varchar({ length: 80 }).notNull(),
    targetType: varchar({ length: 60 }).notNull(),
    targetId: uuid(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    ip: varchar({ length: 45 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('admin_audit_actor_idx').on(table.actorId, table.createdAt)],
);

/** Recomputed nightly (SPEC.md §4). Never computed in the request path. */
export const tutorRanking = pgTable(
  'tutor_ranking',
  {
    tutorId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: integer().notNull().default(0),
    bayesianRatingMilli: integer().notNull().default(4_300),
    completionRateBps: integer().notNull().default(0),
    trialToPaidBps: integer().notNull().default(0),
    availabilityDensityBps: integer().notNull().default(0),
    responseSpeedBps: integer().notNull().default(0),
    recencyBps: integer().notNull().default(0),
    explorationBoost: integer().notNull().default(0),
    reviewCount: integer().notNull().default(0),
    sessionCount: integer().notNull().default(0),
    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('tutor_ranking_score_idx').on(table.score)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ one, many }) => ({
  wallet: one(studentWallets, { fields: [users.id], references: [studentWallets.userId] }),
  tutorProfile: one(tutorProfiles, { fields: [users.id], references: [tutorProfiles.userId] }),
  credentials: many(credentials),
  studentBookings: many(bookings, { relationName: 'studentBookings' }),
}));

export const tutorProfilesRelations = relations(tutorProfiles, ({ one, many }) => ({
  user: one(users, { fields: [tutorProfiles.userId], references: [users.id] }),
  introVideo: one(videos, { fields: [tutorProfiles.introVideoId], references: [videos.id] }),
  ranking: one(tutorRanking, { fields: [tutorProfiles.userId], references: [tutorRanking.tutorId] }),
  subjects: many(tutorSubjects),
  languages: many(tutorLanguages),
}));

export const tutorLanguagesRelations = relations(tutorLanguages, ({ one }) => ({
  tutor: one(tutorProfiles, { fields: [tutorLanguages.tutorId], references: [tutorProfiles.userId] }),
}));

export const tutorSubjectsRelations = relations(tutorSubjects, ({ one }) => ({
  tutor: one(tutorProfiles, { fields: [tutorSubjects.tutorId], references: [tutorProfiles.userId] }),
  subject: one(subjects, { fields: [tutorSubjects.subjectId], references: [subjects.id] }),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  student: one(users, {
    fields: [bookings.studentId],
    references: [users.id],
    relationName: 'studentBookings',
  }),
  tutor: one(users, { fields: [bookings.tutorId], references: [users.id] }),
  subject: one(subjects, { fields: [bookings.subjectId], references: [subjects.id] }),
  review: one(reviews, { fields: [bookings.id], references: [reviews.bookingId] }),
  events: many(sessionEvents),
  ledger: many(ledgerEntries),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  booking: one(bookings, { fields: [ledgerEntries.bookingId], references: [bookings.id] }),
  owner: one(users, { fields: [ledgerEntries.ownerId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TutorProfile = typeof tutorProfiles.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
