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
  check,
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
import { CURRICULUM_STAGES } from '@/lib/curriculum/boards';
import { LEDGER_ACCOUNTS } from '@/lib/money/ledger';
import { PAYOUT_METHOD_KINDS, PAYOUT_STATUSES } from '@/lib/money/payouts';

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

export const curriculumStageEnum = pgEnum('curriculum_stage', CURRICULUM_STAGES);

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

export const payoutMethodKindEnum = pgEnum('payout_method_kind', PAYOUT_METHOD_KINDS);

export const reportTargetEnum = pgEnum('report_target', [
  'user',
  'tutor_profile',
  'booking',
  'review',
  'message',
]);

export const reportStatusEnum = pgEnum('report_status', ['open', 'reviewing', 'resolved', 'dismissed']);

/**
 * The graduated response (SPEC.md §8, §10).
 *
 * There is no `ban` here on purpose. Banning a tutor with regular students does
 * not stop disintermediation — it completes it, by pushing those students to
 * WhatsApp, which is the leak the platform exists to close. So the ladder ends
 * at `review`: a human decides, and even that is appealable.
 */
export const sanctionLevelEnum = pgEnum('sanction_level', ['warning', 'restriction', 'review']);

export const sanctionStatusEnum = pgEnum('sanction_status', [
  'issued',
  'acknowledged',
  'appealed',
  'lifted',
  'upheld',
]);

/** A confidence-scored contact-info detection, waiting for a person. */
export const contactFlagStatusEnum = pgEnum('contact_flag_status', ['pending', 'confirmed', 'dismissed']);

/**
 * A recurring series (SPEC.md §5, DECISIONS_NEEDED item 32).
 *
 * `ending` is not decoration: either side may end a series with seven days'
 * notice, and during those seven days the series is neither running normally
 * nor over. Occurrences inside the notice period still happen.
 */
export const recurringStatusEnum = pgEnum('recurring_status', ['active', 'ending', 'ended']);

/** What a tutor said about a topic after teaching it. */
export const graspEnum = pgEnum('grasp', ['struggling', 'developing', 'secure']);

export const homeworkStatusEnum = pgEnum('homework_status', [
  'assigned',
  'submitted',
  'marked',
  'cancelled',
]);

export const rescheduleStatusEnum = pgEnum('reschedule_status', [
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
]);

/**
 * The in-app bell (SPEC.md §11). Email templates arrive in Phase 7; these are
 * the events Phase 5 actually produces.
 */
export const notificationKindEnum = pgEnum('notification_kind', [
  'trial_requested',
  'trial_accepted',
  'trial_declined',
  'trial_expired',
  'new_message',
  'new_review',
  'review_reply',
  'new_availability',
  /** A warning, a restriction or an appeal outcome. Always links to /settings/notices. */
  'account_notice',
  /** T-24h, T-1h and the tutor's stronger T-10min (SPEC.md §7). */
  'session_reminder',
  /** One person is in the room and the other is not. */
  'session_waiting',
  /** A recurring occurrence is about to be charged and the wallet is short. */
  'series_short',
  /** A recurring occurrence went unpaid and did not happen. */
  'series_lapsed',
  /** Either side ended a recurring series. */
  'series_ending',
  'homework_assigned',
  'homework_submitted',
  'homework_marked',
]);

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
     * When the person confirmed the name we are showing.
     *
     * A student is never asked for their name at signup — it buys them nothing
     * at that moment. Until they give one on the booking form, `name` holds a
     * tidied version of their email's local part, and this is null so every
     * screen that shows it to somebody else knows it is a placeholder rather
     * than a name they chose.
     */
    nameConfirmedAt: timestamp({ withTimezone: true }),
    /**
     * Named for the Auth.js adapter, stored as `avatar_url` per SPEC.md §12.
     * The adapter type-checks the TypeScript key, Postgres sees the spec's name.
     */
    image: text('avatar_url'),
    /** IANA identifier, e.g. `Asia/Karachi`. Never an offset. */
    timezone: varchar({ length: 64 }).notNull().default('UTC'),
    /** ISO 3166-1 alpha-2. Inferred from the browser, never asked for. */
    country: varchar({ length: 2 }),
    city: varchar({ length: 120 }),
    /** WhatsApp reminders. Asked for at the reminder step, never at signup. */
    phone: varchar({ length: 32 }),

    /**
     * "Are you 18 or over?" — the one question signup cannot defer, because the
     * answer changes what we are legally allowed to do with the account.
     *
     * Null for the accounts created before we asked. Not a date of birth: we do
     * not need one, and a date of birth is a far more sensitive thing to hold
     * than a boolean.
     */
    isAdult: boolean(),

    /**
     * The parent or guardian on an under-18 account.
     *
     * Captured at first booking rather than at signup — a 15-year-old browsing
     * tutors has nothing to consent to yet. The email lands first and the id
     * follows when parent accounts exist, which is why the column is here now:
     * adding a foreign key to `users` once bookings and ledger rows reference
     * these accounts is a far worse migration than adding it while it is empty.
     */
    guardianEmail: varchar({ length: 255 }),
    guardianId: uuid(),
    guardianLinkedAt: timestamp({ withTimezone: true }),

    /** Auth.js calls this `emailVerified`; the column is `email_verified_at`. */
    emailVerified: timestamp('email_verified_at', { withTimezone: true }),
    suspendedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_lower_key').on(sql`lower(${table.email})`),
    index('users_roles_idx').using('gin', table.roles),
    // Self-reference, declared here rather than inline to avoid a circular type.
    foreignKey({
      name: 'users_guardian_id_fk',
      columns: [table.guardianId],
      foreignColumns: [table.id],
    }).onDelete('set null'),
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
  /** Short muted MP4. Played by the feed card on hover. */
  previewUrl: text(),
  /** Full-length MP4 with audio. Played by the profile page hero. */
  heroUrl: text(),
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

    /**
     * A rate negotiated with this tutor during recruitment, in basis points, or
     * null — which is most of them.
     *
     * A **floor**, not the rate: the effective commission is the lower of this
     * and the retention rate. Null means "no promise was made". It used to
     * default to 2000, which was a stand-in for the same thing and became
     * actively wrong the moment the first-booking rate rose above 20%.
     */
    commissionBps: integer(),

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
// Curriculum: board, level, subject (SPEC.md §4)
// ---------------------------------------------------------------------------

/**
 * Exam boards and school systems.
 *
 * The id is a readable slug rather than a uuid because it appears in URLs and
 * in the level ids, and because these are a small, admin-curated list rather
 * than user data.
 */
export const boards = pgTable(
  'boards',
  {
    id: varchar({ length: 32 }).primaryKey(),
    name: varchar({ length: 120 }).notNull(),
    sortOrder: smallint().notNull().default(0),
    /** Retired boards stop being offered without breaking anybody's history. */
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('boards_sort_idx').on(table.sortOrder)],
);

/**
 * Which boards a country actually uses, and in what order.
 *
 * The board list is not flat. A student in Lahore should meet CAIE, Edexcel,
 * Punjab Board and Federal Board before anything else, and should not have to
 * scroll past CBSE to find them. Everything stays available — this decides the
 * order, never the membership.
 */
export const boardCountries = pgTable(
  'board_countries',
  {
    boardId: varchar({ length: 32 })
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** ISO 3166-1 alpha-2. */
    country: varchar({ length: 2 }).notNull(),
    sortOrder: smallint().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.country] }),
    index('board_countries_country_idx').on(table.country, table.sortOrder),
  ],
);

/**
 * The levels inside a board.
 *
 * A level only means something inside a board — "AS Level" under CBSE is
 * nonsense — so these are board-scoped and the ids are namespaced. The unique
 * index on `(board_id, id)` is not redundant with the primary key: it is what
 * lets `tutor_curriculum` and `student_curriculum` carry a composite foreign
 * key, so the database itself refuses to store a level under the wrong board.
 */
export const curriculumLevels = pgTable(
  'curriculum_levels',
  {
    id: varchar({ length: 64 }).primaryKey(),
    boardId: varchar({ length: 32 })
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: varchar({ length: 120 }).notNull(),
    /** The board-independent rung, used for near matches across boards. */
    stage: curriculumStageEnum().notNull(),
    sortOrder: smallint().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (table) => [
    uniqueIndex('curriculum_levels_board_id_key').on(table.boardId, table.id),
    index('curriculum_levels_board_idx').on(table.boardId, table.sortOrder),
  ],
);

/**
 * The chapters inside a (board, class, subject) (SPEC.md §4).
 *
 * Nobody teaches a whole syllabus in an hour. Without this, a booking says
 * "Chemistry" and both sides find out what it was actually for in the first
 * five minutes — which is five minutes of an hour somebody paid for.
 *
 * Scoped the same way a level is: the composite foreign key onto
 * `curriculum_levels (board_id, id)` means "Electrolysis, CAIE, IGCSE" cannot
 * be stored under CBSE whatever the application believes.
 *
 * It is also the retention engine. A student who can see fourteen of
 * twenty-two chapters covered has a reason to book the fifteenth, and that is
 * a better reason than a discount.
 */
export const topics = pgTable(
  'topics',
  {
    id: uuid().primaryKey().defaultRandom(),
    boardId: varchar({ length: 32 })
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    levelId: varchar({ length: 64 }).notNull(),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    name: varchar({ length: 160 }).notNull(),
    /** Chapter or unit number as the syllabus prints it, when it has one. */
    reference: varchar({ length: 32 }),
    sortOrder: smallint().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'topics_level_fk',
      columns: [table.boardId, table.levelId],
      foreignColumns: [curriculumLevels.boardId, curriculumLevels.id],
    }).onDelete('cascade'),
    uniqueIndex('topics_position_name_key').on(
      table.boardId,
      table.levelId,
      table.subjectId,
      table.name,
    ),
    index('topics_position_idx').on(table.boardId, table.levelId, table.subjectId, table.sortOrder),
  ],
);

/** How many topics a student may attach to one booking. */
export const MAX_TOPICS_PER_BOOKING = 5;

/**
 * What a session was for, and what it turned out to cover.
 *
 * Written twice: the student picks topics at booking, and the tutor marks
 * `covered` afterwards. They are separate columns because they are separate
 * facts — a session that was booked for three chapters and got through one is
 * a normal session, and pretending otherwise would make the progress view a
 * lie.
 */
export const bookingTopics = pgTable(
  'booking_topics',
  {
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    topicId: uuid()
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    /** Null until the tutor says. Not the same as false. */
    covered: boolean(),
    /** Optional, and deliberately three rungs rather than five stars. */
    grasp: graspEnum(),
    markedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.bookingId, table.topicId] }),
    index('booking_topics_topic_idx').on(table.topicId),
  ],
);

/**
 * Topics a tutor says they are strong on.
 *
 * A tiebreak *within* an existing tier of the ranking, never a tier of its
 * own — see `lib/curriculum/ordering.ts`. A tutor who teaches the exact board,
 * class and subject outranks one who does not, whatever either of them has
 * declared here.
 */
export const tutorTopics = pgTable(
  'tutor_topics',
  {
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid()
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tutorId, table.topicId] }),
    index('tutor_topics_topic_idx').on(table.topicId),
  ],
);

/** How many curriculum positions one tutor may declare. */
export const MAX_TUTOR_CURRICULUM = 15;

/**
 * What a tutor teaches, as (board, level, subject) triples.
 *
 * `tutor_subjects` stays: it carries years of experience and the free-text
 * level a tutor describes themselves at, and it is what the profile shows. This
 * table is the machine-readable position that matching runs on, and the write
 * path keeps the two coherent by only offering subjects the tutor has declared.
 */
export const tutorCurriculum = pgTable(
  'tutor_curriculum',
  {
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: varchar({ length: 32 })
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    levelId: varchar({ length: 64 }).notNull(),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tutorId, table.boardId, table.levelId, table.subjectId] }),
    // The composite key is what makes "AS Level under CBSE" unstorable.
    foreignKey({
      name: 'tutor_curriculum_level_fk',
      columns: [table.boardId, table.levelId],
      foreignColumns: [curriculumLevels.boardId, curriculumLevels.id],
    }).onDelete('cascade'),
    index('tutor_curriculum_position_idx').on(table.boardId, table.levelId, table.subjectId),
    index('tutor_curriculum_subject_idx').on(table.subjectId),
  ],
);

/**
 * Where a student is.
 *
 * One row is the primary position — the one the feed applies by default — and
 * the partial unique index is what makes "primary" mean exactly one thing.
 */
export const studentCurriculum = pgTable(
  'student_curriculum',
  {
    id: uuid().primaryKey().defaultRandom(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: varchar({ length: 32 })
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    levelId: varchar({ length: 64 }).notNull(),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    isPrimary: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('student_curriculum_position_key').on(
      table.studentId,
      table.boardId,
      table.levelId,
      table.subjectId,
    ),
    uniqueIndex('student_curriculum_primary_key')
      .on(table.studentId)
      .where(sql`is_primary`),
    foreignKey({
      name: 'student_curriculum_level_fk',
      columns: [table.boardId, table.levelId],
      foreignColumns: [curriculumLevels.boardId, curriculumLevels.id],
    }).onDelete('cascade'),
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

    /**
     * The standing arrangement this occurrence belongs to, if any.
     *
     * A booking with a series is not a lesser booking: it moves through the
     * same state machine, holds the same slot and settles the same way. The
     * only difference is when its credits are taken.
     */
    seriesId: uuid().references(() => recurringSeries.id, { onDelete: 'set null' }),
    /** The local date of the occurrence, so materialisation cannot double up. */
    occurrenceDate: date(),

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

    /**
     * What the student typed that no topic covers — "I do not understand
     * titration calculations".
     *
     * The list of topics is a taxonomy somebody curated; this is the sentence
     * the student would actually say, and it is often the more useful of the
     * two. The tutor sees it before the session, and before accepting a trial.
     */
    topicNote: text(),

    rescheduleCount: smallint().notNull().default(0),
    /**
     * Stamped when the session actually happened — both parties present for at
     * least half the booked time (SPEC.md §7). Null means it did not, whatever
     * the status says, and a review needs it (SPEC.md §9).
     */
    completedAt: timestamp({ withTimezone: true }),
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
      // Kept in step with ACTIVE_BOOKING_STATUSES by hand, because a partial
      // index predicate cannot be interpolated. `scheduled` belongs here: a
      // recurring occurrence holds its hour from the moment it is materialised.
      .where(sql`status in ('scheduled', 'pending_tutor', 'confirmed', 'in_progress')`),
    /** SPEC.md §6: one free trial per student-tutor pair, for life. */
    uniqueIndex('one_trial_per_pair')
      .on(table.studentId, table.tutorId)
      .where(sql`is_trial = true`),
    /**
     * One booking per series occurrence.
     *
     * The materialisation job is meant to be safe to run twice — a cron that
     * fires on a retry, two workers, a hand-run during a backfill — and this
     * is what makes that true rather than hoped for. Cancelled occurrences are
     * still in here, so re-running does not resurrect a cancelled Tuesday.
     */
    uniqueIndex('one_booking_per_occurrence')
      .on(table.seriesId, table.occurrenceDate)
      .where(sql`series_id is not null`),
    index('bookings_series_idx').on(table.seriesId, table.startAtUtc),
    index('bookings_student_idx').on(table.studentId, table.startAtUtc),
    index('bookings_tutor_idx').on(table.tutorId, table.startAtUtc),
    index('bookings_status_idx').on(table.status, table.startAtUtc),
  ],
);

/**
 * A standing arrangement: same time, same weekdays, until somebody stops it
 * (SPEC.md §5, DECISIONS_NEEDED item 32).
 *
 * The market this is for sells a month, not an hour — "three sessions a week,
 * 50,000 a month". A student who has decided that should not have to decide it
 * again every Tuesday. So the series is the commitment, made once.
 *
 * Two things it deliberately does not do:
 *
 *  - **It does not take a month's money.** There is no balance on this row.
 *    Each occurrence is charged at its own T-48h, and one that cannot be paid
 *    for lapses visibly. Holding four weeks of somebody's money against
 *    tutoring that has not happened is a float we have not earned.
 *  - **It does not materialise forever.** `series_jobs` keeps four weeks of
 *    real bookings ahead of today and rolls forward weekly. Rows stretching to
 *    the heat death of the universe are not a schedule, they are a landfill.
 *
 * `price_cents` is snapshotted here rather than read from the tutor's rate at
 * each materialisation, because a standing arrangement at an agreed price is
 * what both sides think they agreed. A tutor who wants a new price ends the
 * series and offers a new one.
 *
 * The weekday and the time are in `timezone`, which is the **tutor's** at
 * creation. That side is anchored because the tutor's published hours are, so
 * the slot keeps landing inside them across a DST change; the student sees the
 * shift on their own upcoming list, which is what a standing appointment
 * across five time zones actually does.
 */
export const recurringSeries = pgTable(
  'recurring_series',
  {
    id: uuid().primaryKey().defaultRandom(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    subjectId: uuid().references(() => subjects.id, { onDelete: 'set null' }),

    /** 0 = Sunday, in `timezone`. One to seven of them. */
    weekdays: smallint().array().notNull(),
    /** `HH:MM:SS` in `timezone`. */
    startTimeLocal: time().notNull(),
    timezone: varchar({ length: 64 }).notNull(),
    durationMinutes: smallint().notNull(),

    /** The agreed price per session. Never re-read from the tutor's rate. */
    priceCents: integer().notNull(),

    startsOn: date().notNull(),
    /** Null while open-ended. Set to the notice date when somebody ends it. */
    endsOn: date(),

    status: recurringStatusEnum().notNull().default('active'),
    endedBy: partyEnum(),
    endedAt: timestamp({ withTimezone: true }),
    /** The student and the tutor both read this. */
    endReason: text(),

    /** How far ahead occurrences have been created, so the job is idempotent. */
    materialisedThrough: date(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('recurring_series_tutor_idx').on(table.tutorId, table.status),
    index('recurring_series_student_idx').on(table.studentId, table.status),
    check(
      'recurring_series_weekdays',
      sql`array_length(weekdays, 1) between 1 and 7
          and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]`,
    ),
    check('recurring_series_duration', sql`duration_minutes in (30, 60)`),
    check('recurring_series_price', sql`price_cents > 0`),
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
    /**
     * LiveKit's own event id. Webhooks are delivered more than once, and a
     * redelivered join that counted twice would inflate attendance and so the
     * tutor's pay.
     */
    externalId: varchar({ length: 200 }).notNull(),
    /** The raw LiveKit webhook body, kept verbatim for disputes. */
    raw: jsonb().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex('session_events_external_id').on(table.externalId),
    index('session_events_booking_idx').on(table.bookingId, table.atUtc),
  ],
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
  /** Offered only as somebody's very first purchase. See `lib/money/packs.ts`. */
  firstPurchaseOnly: boolean().notNull().default(false),
});

/**
 * A ten-minute claim on a slot while a student buys the credits for it
 * (SPEC.md §5).
 *
 * Not a booking, and no substitute for one: the guarantee that two people
 * cannot take the same slot is the partial unique index on `bookings`. This
 * only stops a second student *starting* down that path. Expiry is checked by
 * every query that reads it — `expires_at > now()` — rather than by a sweeper.
 */
export const slotHolds = pgTable(
  'slot_holds',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Null while the person holding it has not signed up yet. */
    studentId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    /**
     * A cookie value identifying a visitor with no account.
     *
     * Somebody browsing signed out can pick a slot, and the slot has to survive
     * the trip through signup — otherwise "sign up to book this" means "sign up
     * and find out whether it is still there". On the way back the hold is
     * claimed: `student_id` is set and this is cleared.
     *
     * It is not a credential. Guessing one wins nothing but a ten-minute claim
     * on a slot that is already publicly visible as held.
     */
    guestToken: uuid(),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startAtUtc: timestamp({ withTimezone: true }).notNull(),
    durationMinutes: smallint().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** One holder, one hold on a given slot — re-picking it just extends theirs. */
    uniqueIndex('slot_holds_student_slot')
      .on(table.studentId, table.tutorId, table.startAtUtc)
      .where(sql`student_id is not null`),
    uniqueIndex('slot_holds_guest_slot')
      .on(table.guestToken, table.tutorId, table.startAtUtc)
      .where(sql`guest_token is not null`),
    index('slot_holds_slot_idx').on(table.tutorId, table.startAtUtc, table.expiresAt),
    /** Exactly one holder: an account or a guest, never both and never neither. */
    check(
      'slot_holds_one_holder',
      sql`(student_id is null) <> (guest_token is null)`,
    ),
  ],
);

/**
 * A proposed new time, waiting on the other side (SPEC.md §5).
 *
 * The original booking stands until this is accepted, so nothing about the
 * booking changes while a request is open — which is why the new time lives
 * here rather than on the booking row.
 */
export const rescheduleRequests = pgTable(
  'reschedule_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    requestedById: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestedBy: partyEnum().notNull(),
    newStartAtUtc: timestamp({ withTimezone: true }).notNull(),
    status: rescheduleStatusEnum().notNull().default('pending'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    note: varchar({ length: 300 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    /** One open request per booking, enforced where it cannot be raced. */
    uniqueIndex('reschedule_one_open_per_booking')
      .on(table.bookingId)
      .where(sql`status = 'pending'`),
    index('reschedule_booking_idx').on(table.bookingId, table.createdAt),
  ],
);

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
    /**
     * Snapshotted from the pack, so the restriction survives an admin later
     * editing or retiring it — and so the index below has a column to stand on.
     */
    firstPurchaseOnly: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('credit_purchases_idempotency_key').on(table.idempotencyKey),
    index('credit_purchases_user_idx').on(table.userId, table.createdAt),
    /**
     * One first-purchase-only pack per person, ever.
     *
     * A check in the server action would pass twice in two tabs. This does not.
     * Failed attempts are excluded so a card decline does not permanently burn
     * somebody's one cheap pack.
     */
    uniqueIndex('credit_purchases_first_only_key')
      .on(table.userId)
      .where(sql`first_purchase_only and status <> 'failed'`),
  ],
);

/**
 * Where a tutor's money goes.
 *
 * Two shapes, because in this market they are genuinely different things. A
 * bank account is an IBAN or an account number with a branch code; a mobile
 * wallet is a phone number at JazzCash or Easypaisa, and for a great many
 * tutors here it is the only account they have. Forcing a wallet into
 * bank-shaped columns would mean storing a phone number in `account_number`
 * and lying about `bank_name`.
 *
 * **Every identifying number is encrypted by the application** — see
 * `src/lib/crypto.ts`. Disk encryption is not enough: a read replica, a backup
 * or a `select *` in a support tool would all show account numbers otherwise.
 * `last4` is the only part of any of them that may be rendered, to anybody,
 * including an admin. `pnpm prove:payout-privacy` dumps the table and checks.
 */
export const payoutMethods = pgTable(
  'payout_methods',
  {
    id: uuid().primaryKey().defaultRandom(),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: payoutMethodKindEnum().notNull().default('bank'),
    /** The name on the account, as the bank or wallet has it. */
    accountTitle: varchar({ length: 200 }).notNull(),
    /** Null for a mobile wallet, which has no bank. */
    bankName: varchar({ length: 200 }),
    /** `jazzcash` or `easypaisa`. Null for a bank account. */
    walletProvider: varchar({ length: 32 }),
    country: varchar({ length: 2 }).notNull(),
    /**
     * AES-256-GCM ciphertext of the IBAN, account number or wallet mobile
     * number. Never logged, never returned, never rendered.
     */
    accountNumberEnc: text().notNull(),
    swiftEnc: text(),
    /** Pakistani local accounts are addressed by branch code, not by SWIFT. */
    branchCodeEnc: text(),
    /** Optional, Pakistan-domiciled tutors only. */
    cnicEnc: text(),
    /** The only part of any of the above the UI is allowed to show. */
    last4: varchar({ length: 4 }).notNull(),
    isDefault: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payout_methods_tutor_idx').on(table.tutorId),
    /** One default per tutor: "where does the money go" has one answer. */
    uniqueIndex('payout_methods_default_key').on(table.tutorId).where(sql`is_default`),
    /**
     * A bank has a name, a wallet has a provider, and neither has the other.
     * Enforced here rather than in a form, because a half-filled payout method
     * is a payment that fails at the bank.
     */
    check(
      'payout_methods_shape',
      sql`(kind = 'bank' and bank_name is not null and wallet_provider is null)
          or (kind = 'mobile_wallet' and wallet_provider is not null and bank_name is null)`,
    ),
  ],
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
    tutorRepliedAt: timestamp({ withTimezone: true }),
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
    /**
     * How many pieces of contact information were taken out. Lets the UI show
     * the notice without reading — or even comparing against — the raw body.
     */
    redactions: smallint().notNull().default(0),
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

    /**
     * What was done and why.
     *
     * `admin_audit` has this too and is the record of last resort, but the
     * queue itself has to show the outcome: an admin picking up a report needs
     * to see that the last one from this reporter was dismissed as vexatious
     * without going and reading the audit log.
     */
    resolutionAction: varchar({ length: 40 }),
    resolutionReason: text(),
    resolvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('reports_status_idx').on(table.status, table.createdAt),
    index('reports_target_idx').on(table.targetType, table.targetId),
  ],
);

/**
 * Messages a scorer thinks were trying to move the conversation off Tutorly.
 *
 * A flag is **not** an action and never becomes one on its own. It carries the
 * score and the reasons behind it (`signals`) so the person reviewing it can
 * see why the machine thought so and disagree cheaply. Nothing in the product
 * reads `status = 'confirmed'` except the sanction ladder, and that only runs
 * when an admin presses the button.
 *
 * There is no unique index letting one message be flagged twice, because a
 * message is scored exactly once, on write.
 */
export const contactFlags = pgTable(
  'contact_flags',
  {
    id: uuid().primaryKey().defaultRandom(),
    messageId: uuid()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    threadId: uuid()
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    senderId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 0 to 100. An ordering for the queue, not a probability. */
    score: smallint().notNull(),
    band: varchar({ length: 8 }).notNull(),
    /** `[{ id, weight, note }]` — the plain-English reasons, for the reviewer. */
    signals: jsonb().notNull().default(sql`'[]'::jsonb`),
    status: contactFlagStatusEnum().notNull().default('pending'),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('contact_flags_message_key').on(table.messageId),
    index('contact_flags_queue_idx').on(table.status, table.score),
    index('contact_flags_sender_idx').on(table.senderId, table.createdAt),
  ],
);

/**
 * The graduated response, one row per step (SPEC.md §8).
 *
 * First confirmed attempt is a warning the person has to acknowledge. Second
 * removes a privilege that costs them something without costing their existing
 * students anything — new trial requests and ranking position, never the
 * ability to teach the students they already have. Third goes to a human, who
 * may suspend. Every step is appealable and every step is here.
 *
 * `issuedBy` is not nullable: nothing issues one of these automatically, so
 * there is always a person to name.
 */
export const userSanctions = pgTable(
  'user_sanctions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    level: sanctionLevelEnum().notNull(),
    /** What the person is told. They read this verbatim. */
    reason: text().notNull(),
    /** Where it came from: `contact_flag` or `report`, and which one. */
    source: varchar({ length: 32 }).notNull(),
    sourceId: uuid(),
    issuedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Null while a warning sits unread. Acknowledging is the whole point of a warning. */
    acknowledgedAt: timestamp({ withTimezone: true }),
    /** When a restriction stops applying. Null for a warning, which never expires. */
    restrictedUntil: timestamp({ withTimezone: true }),
    status: sanctionStatusEnum().notNull().default('issued'),
    appealNote: text(),
    appealedAt: timestamp({ withTimezone: true }),
    appealDecidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    appealDecidedAt: timestamp({ withTimezone: true }),
    appealOutcome: text(),
  },
  (table) => [
    index('user_sanctions_user_idx').on(table.userId, table.issuedAt),
    /** The lookup on every request that asks "is this person restricted?". */
    index('user_sanctions_active_idx').on(table.userId, table.restrictedUntil),
  ],
);

/**
 * Work between sessions (SPEC.md §9).
 *
 * The strongest thing on this platform against somebody taking the
 * relationship elsewhere, and it is not a restriction — it is value that only
 * exists here. A tutor and a student who move to WhatsApp keep the video call
 * and lose this: the assignment tied to a chapter, the file, the mark, and the
 * record of both.
 *
 * Tied to a booking rather than floating free, because "revise what we did on
 * Tuesday" is the assignment that gets done and "revise chapter four" is the
 * one that does not.
 */
export const homework = pgTable(
  'homework',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    tutorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** What it is about, so it lands in the progress view. */
    topicId: uuid().references(() => topics.id, { onDelete: 'set null' }),

    title: varchar({ length: 200 }).notNull(),
    body: text(),
    /** Papers the tutor attached, through the same presigned path as messages. */
    attachments: jsonb().notNull().default(sql`'[]'::jsonb`),
    dueAt: timestamp({ withTimezone: true }),

    status: homeworkStatusEnum().notNull().default('assigned'),

    /** The submission. One per assignment; resubmitting replaces it. */
    submissionBody: text(),
    submissionAttachments: jsonb().notNull().default(sql`'[]'::jsonb`),
    submittedAt: timestamp({ withTimezone: true }),

    /**
     * The mark, out of `markOutOf`, or null for work that is not marked
     * numerically — which is most of it. The feedback is the point.
     */
    mark: smallint(),
    markOutOf: smallint(),
    feedback: text(),
    markedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('homework_student_idx').on(table.studentId, table.status, table.dueAt),
    index('homework_tutor_idx').on(table.tutorId, table.status),
    index('homework_booking_idx').on(table.bookingId),
    check('homework_mark_range', sql`mark is null or (mark_out_of is not null and mark between 0 and mark_out_of)`),
  ],
);

/**
 * The in-app bell (SPEC.md §11).
 *
 * Not in SPEC.md §12's table list — see DECISIONS_NEEDED.md item 5. Phase 5
 * needs somewhere to put "a tutor you follow published new hours", and an email
 * with no in-app equivalent would be a notification you cannot go back and read.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum().notNull(),
    title: varchar({ length: 160 }).notNull(),
    body: varchar({ length: 400 }),
    /** Where the bell takes you. Always an in-app path. */
    href: varchar({ length: 300 }),
    /**
     * Stops the same event notifying twice — a tutor saving their calendar
     * three times in a morning is one piece of news, not three.
     */
    dedupeKey: varchar({ length: 200 }),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_user_idx').on(table.userId, table.createdAt),
    uniqueIndex('notifications_dedupe_key').on(table.dedupeKey),
  ],
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
    /**
     * A 24-bit mask of the UTC hours this tutor is typically free.
     *
     * The tutor half of the timezone-overlap term (`src/lib/ranking/overlap.ts`).
     * Expensive to derive, so it is derived here, nightly; the request path only
     * ANDs it with the viewer's own mask and counts the bits. Zero means "no
     * published hours", which the term scores as unknown rather than as never.
     */
    freeHoursMask: integer().notNull().default(0),
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

export const boardsRelations = relations(boards, ({ many }) => ({
  levels: many(curriculumLevels),
  countries: many(boardCountries),
}));

export const curriculumLevelsRelations = relations(curriculumLevels, ({ one }) => ({
  board: one(boards, { fields: [curriculumLevels.boardId], references: [boards.id] }),
}));

export const tutorCurriculumRelations = relations(tutorCurriculum, ({ one }) => ({
  tutor: one(users, { fields: [tutorCurriculum.tutorId], references: [users.id] }),
  board: one(boards, { fields: [tutorCurriculum.boardId], references: [boards.id] }),
  level: one(curriculumLevels, { fields: [tutorCurriculum.levelId], references: [curriculumLevels.id] }),
  subject: one(subjects, { fields: [tutorCurriculum.subjectId], references: [subjects.id] }),
}));

export const studentCurriculumRelations = relations(studentCurriculum, ({ one }) => ({
  student: one(users, { fields: [studentCurriculum.studentId], references: [users.id] }),
  board: one(boards, { fields: [studentCurriculum.boardId], references: [boards.id] }),
  level: one(curriculumLevels, {
    fields: [studentCurriculum.levelId],
    references: [curriculumLevels.id],
  }),
  subject: one(subjects, { fields: [studentCurriculum.subjectId], references: [subjects.id] }),
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
export type Board = typeof boards.$inferSelect;
export type CurriculumLevel = typeof curriculumLevels.$inferSelect;
export type TutorCurriculum = typeof tutorCurriculum.$inferSelect;
export type StudentCurriculum = typeof studentCurriculum.$inferSelect;
