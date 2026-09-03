'use server';

/**
 * The wizard's writes (SPEC.md §3).
 *
 * One action per step. Each one:
 *   - re-reads who is calling from the session, never from the form
 *   - refuses to write unless the profile is still editable
 *   - validates with zod, and on failure redirects back to the same step with a
 *     message rather than throwing a stack trace at the tutor
 *   - saves immediately, so leaving the page never loses what was typed
 *
 * Every step is a draft save. Nothing here changes the profile's status except
 * `submitProfile` and `withdrawProfile`.
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  availabilityExceptions,
  availabilityRules,
  credentials,
  payoutMethods,
  tutorLanguages,
  tutorProfiles,
  tutorSubjects,
  users,
  videos,
} from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { encryptSecret, last4 } from '@/lib/crypto';
import { isProficiency, isLanguageCode } from '@/lib/tutors/languages';
import {
  credentialChangeTriggersReview,
  isEditable,
  transitionTutor,
  type TutorStatus,
} from '@/lib/tutors/status';
import { submitForReview, withdrawSubmission, VerificationError } from '@/lib/tutors/verification';
import {
  BIO_MAX,
  BIO_MIN,
  BUFFER_MINUTE_OPTIONS,
  HEADLINE_MAX,
  MAX_SUBJECTS,
  TRIAL_MINUTE_OPTIONS,
  type WizardStepSlug,
} from '@/lib/tutors/wizard';
import {
  assertValidHalfHourCents,
  assertValidHourlyCents,
  deriveHalfHourCents,
} from '@/lib/money/pricing';
import {
  avatarKey,
  createUploadTarget,
  credentialKey,
  getObjectStore,
  introVideoKey,
  publicUrlFor,
} from '@/lib/storage';
import {
  checkIntroLength,
  getVideoPipeline,
  isVideoPipelineAvailable,
  VIDEO_PIPELINE_UNAVAILABLE_MESSAGE,
} from '@/lib/video';
import { checkUpload, type UploadKind } from '@/lib/storage/uploads';
import { clockToString, getLocalParts, isValidTimeZone, zonedTimeToUtc } from '@/lib/time';

const BASE = '/tutor/onboarding';

function backTo(step: WizardStepSlug, error: string): never {
  redirect(`${BASE}/${step}?error=${encodeURIComponent(error)}`);
}

function onwards(step: WizardStepSlug, next: WizardStepSlug): never {
  revalidatePath(`${BASE}/${step}`);
  redirect(`${BASE}/${next}?saved=1`);
}

/**
 * The session's tutor, and a guarantee the profile can still be edited.
 * A profile in `pending_review` is with an admin; editing it under them would
 * mean they approved something other than what they read.
 */
async function editableTutor(step: WizardStepSlug) {
  const user = await requireRole('tutor');

  const [profile] = await db
    .select({ status: tutorProfiles.status, introVideoId: tutorProfiles.introVideoId })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, user.id))
    .limit(1);

  if (!profile) backTo(step, 'Your tutor profile is missing. Contact support.');
  if (!isEditable(profile.status as TutorStatus)) {
    backTo(step, 'Your profile is being reviewed. Withdraw it first if you need to make changes.');
  }

  return { user, profile: { ...profile, status: profile.status as TutorStatus } };
}

/** Reads an uploaded file, checks it, and puts it in the right bucket. */
async function storeUpload(
  kind: UploadKind,
  file: File,
  buildKey: (extension: string) => string,
): Promise<{ key: string; contentType: string } | { error: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(kind, { size: bytes.byteLength, type: file.type }, bytes.subarray(0, 16));
  if (!check.ok) return { error: check.reason };

  const key = buildKey(check.extension);
  const bucket = key.startsWith('credentials/') ? 'private' : 'public';
  await getObjectStore().put(bucket, key, bytes, check.contentType);

  return { key, contentType: check.contentType };
}

// ---------------------------------------------------------------------------
// Step 2 — identity
// ---------------------------------------------------------------------------

const identitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  country: z.string().trim().length(2),
  city: z.string().trim().min(1).max(120),
  timezone: z.string().trim().max(64),
});

export async function saveIdentity(formData: FormData): Promise<void> {
  const { user } = await editableTutor('identity');

  const parsed = identitySchema.safeParse({
    name: formData.get('name'),
    country: formData.get('country'),
    city: formData.get('city'),
    timezone: formData.get('timezone'),
  });
  if (!parsed.success) backTo('identity', 'Fill in your name, country, city and timezone.');
  if (!isValidTimeZone(parsed.data.timezone)) backTo('identity', 'Pick a timezone from the list.');

  // Languages arrive as `language:<code>` = proficiency, one per checked row.
  const languages: { languageCode: string; proficiency: string }[] = [];
  for (const [field, value] of formData.entries()) {
    if (!field.startsWith('language:')) continue;
    const code = field.slice('language:'.length);
    const proficiency = String(value);
    if (isLanguageCode(code) && isProficiency(proficiency)) {
      languages.push({ languageCode: code, proficiency });
    }
  }
  if (languages.length === 0) backTo('identity', 'Add at least one language you teach in.');

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        name: parsed.data.name,
        country: parsed.data.country.toUpperCase(),
        city: parsed.data.city,
        timezone: parsed.data.timezone,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await tx.delete(tutorLanguages).where(eq(tutorLanguages.tutorId, user.id));
    await tx
      .insert(tutorLanguages)
      .values(
        languages.map((language) => ({
          tutorId: user.id,
          languageCode: language.languageCode,
          proficiency: language.proficiency as 'basic',
        })),
      );
  });

  onwards('identity', 'profile');
}

// ---------------------------------------------------------------------------
// Step 3 — profile
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  headline: z.string().trim().min(1).max(HEADLINE_MAX),
  bio: z.string().trim().min(BIO_MIN).max(BIO_MAX),
});

export async function saveProfile(formData: FormData): Promise<void> {
  const { user } = await editableTutor('profile');

  const parsed = profileSchema.safeParse({
    headline: formData.get('headline'),
    bio: formData.get('bio'),
  });
  if (!parsed.success) {
    backTo('profile', `Headline up to ${HEADLINE_MAX} characters, and a bio of ${BIO_MIN}–${BIO_MAX}.`);
  }

  const photo = formData.get('photo');
  let imageUrl: string | undefined;

  if (photo instanceof File && photo.size > 0) {
    const stored = await storeUpload('avatar', photo, (extension) =>
      avatarKey(user.id, randomUUID(), extension),
    );
    if ('error' in stored) backTo('profile', stored.error);
    imageUrl = `/api/public-files/${stored.key}`;
  }

  await db
    .update(users)
    .set({ ...(imageUrl ? { image: imageUrl } : {}), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await db
    .update(tutorProfiles)
    .set({ headline: parsed.data.headline, bio: parsed.data.bio, updatedAt: new Date() })
    .where(eq(tutorProfiles.userId, user.id));

  onwards('profile', 'video');
}

// ---------------------------------------------------------------------------
// Step 4 — intro video
//
// A 30-90 second marketing clip, and the only video Tutorly stores. Teaching
// itself is live, so nothing here is a lesson recording.
//
// Upload -> probe -> HLS ladder + card preview + three thumbnail candidates ->
// the tutor picks one. The transcode runs inline, which is fine for a 90-second
// clip in development; production should hand it to a queue (SPEC.md §14).
// ---------------------------------------------------------------------------

export type UploadTicket =
  | { ok: true; url: string; key: string; headers: Record<string, string> }
  | { ok: false; error: string };

/**
 * Step one of the video upload: ask for somewhere to put the file.
 *
 * The browser then PUTs the bytes straight there and calls `attachIntroVideo`
 * with the key. The file never passes through a Server Action, which could not
 * carry it (see src/lib/storage/direct-upload.ts).
 */
export async function requestIntroVideoUpload(input: {
  contentType: string;
  size: number;
}): Promise<UploadTicket> {
  const { user } = await editableTutor('video');

  const check = checkUpload('introVideo', { size: input.size, type: input.contentType });
  if (!check.ok) return { ok: false, error: check.reason };

  const key = introVideoKey(user.id, randomUUID(), check.extension);
  const target = await createUploadTarget('public', key, check.contentType);

  return { ok: true, url: target.url, key: target.key, headers: target.headers };
}

/**
 * Step two: the bytes are in the bucket, so probe and transcode them.
 *
 * The transcode runs inline, which is fine for a 90-second clip in development.
 * Production should hand it to a queue (SPEC.md §14) — see DECISIONS_NEEDED.md.
 */
export async function attachIntroVideo(key: string): Promise<{ ok: boolean; error?: string }> {
  const { user, profile } = await editableTutor('video');

  // The key came from the browser, so it has to be one this tutor could own.
  if (!key.startsWith(`videos/${user.id}/`)) {
    return { ok: false, error: 'That upload does not belong to your account.' };
  }

  const uploaded = await getObjectStore().get('public', key);
  if (!uploaded) {
    return { ok: false, error: 'We did not receive that file. Try uploading it again.' };
  }

  const videoId = randomUUID();

  await db.insert(videos).values({
    id: videoId,
    ownerId: user.id,
    sourceKey: key,
    status: 'processing',
  });

  const previousVideoId = profile.introVideoId;
  await db
    .update(tutorProfiles)
    .set({ introVideoId: videoId, updatedAt: new Date() })
    .where(eq(tutorProfiles.userId, user.id));

  if (previousVideoId) {
    await db.delete(videos).where(eq(videos.id, previousVideoId));
  }

  const cleanUp = async () => {
    await db.update(tutorProfiles).set({ introVideoId: null }).where(eq(tutorProfiles.userId, user.id));
    await db.delete(videos).where(eq(videos.id, videoId));
    await getObjectStore().delete('public', key);
  };

  if (!(await isVideoPipelineAvailable())) {
    await db
      .update(videos)
      .set({ status: 'failed', error: VIDEO_PIPELINE_UNAVAILABLE_MESSAGE, updatedAt: new Date() })
      .where(eq(videos.id, videoId));
    return { ok: false, error: VIDEO_PIPELINE_UNAVAILABLE_MESSAGE };
  }

  const pipeline = getVideoPipeline();

  try {
    const probe = await pipeline.probe(key);
    const length = checkIntroLength(probe.durationSeconds);
    if (!length.ok) {
      // The wrong clip, not a broken pipeline: leave the step simply unfinished.
      await cleanUp();
      return { ok: false, error: length.reason };
    }

    const output = await pipeline.transcode({ sourceKey: key, ownerId: user.id, videoId });

    await db
      .update(videos)
      .set({
        previewUrl: publicUrlFor(output.previewKey),
        heroUrl: publicUrlFor(output.heroKey),
        thumbnailCandidates: output.thumbnailKeys.map(publicUrlFor),
        // Default to the middle candidate; the tutor can change it.
        thumbnailUrl: publicUrlFor(output.thumbnailKeys[Math.floor(output.thumbnailKeys.length / 2)]!),
        durationS: Math.round(output.durationSeconds),
        width: output.width,
        height: output.height,
        status: 'ready',
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));
  } catch (error) {
    console.error('intro video transcode failed', error);
    const message = 'We could not process that clip. Try exporting it again as an MP4.';
    await db
      .update(videos)
      .set({ status: 'failed', error: message, updatedAt: new Date() })
      .where(eq(videos.id, videoId));
    return { ok: false, error: message };
  }

  revalidatePath(`${BASE}/video`);
  return { ok: true };
}

/** The tutor picks which of the three stills becomes their poster. */
export async function selectThumbnail(formData: FormData): Promise<void> {
  const { user } = await editableTutor('video');

  const chosen = String(formData.get('thumbnailUrl') ?? '');

  const [video] = await db
    .select({ id: videos.id, candidates: videos.thumbnailCandidates })
    .from(videos)
    .innerJoin(tutorProfiles, eq(tutorProfiles.introVideoId, videos.id))
    .where(eq(tutorProfiles.userId, user.id))
    .limit(1);

  // Only one of this tutor's own candidates is acceptable — the value came from
  // a form, so it is not trusted as a URL to store.
  if (!video || !video.candidates.includes(chosen)) {
    backTo('video', 'Pick one of the three thumbnails.');
  }

  await db
    .update(videos)
    .set({ thumbnailUrl: chosen, updatedAt: new Date() })
    .where(eq(videos.id, video.id));

  revalidatePath(`${BASE}/video`);
  redirect(`${BASE}/video?saved=1`);
}

// ---------------------------------------------------------------------------
// Step 5 — subjects
// ---------------------------------------------------------------------------

export async function saveSubjects(formData: FormData): Promise<void> {
  const { user } = await editableTutor('subjects');

  const chosen = formData.getAll('subject').map(String);
  if (chosen.length === 0) backTo('subjects', 'Pick at least one subject.');
  if (chosen.length > MAX_SUBJECTS) backTo('subjects', `Pick at most ${MAX_SUBJECTS} subjects.`);

  const rows = chosen.map((subjectId) => {
    const level = String(formData.get(`level:${subjectId}`) ?? 'beginner');
    const years = Number(formData.get(`years:${subjectId}`) ?? 0);
    return {
      tutorId: user.id,
      subjectId,
      level: (['beginner', 'intermediate', 'advanced', 'exam_prep'].includes(level)
        ? level
        : 'beginner') as 'beginner',
      yearsExperience: Number.isFinite(years) ? Math.max(0, Math.min(60, Math.trunc(years))) : 0,
    };
  });

  await db.transaction(async (tx) => {
    await tx.delete(tutorSubjects).where(eq(tutorSubjects.tutorId, user.id));
    await tx.insert(tutorSubjects).values(rows);
  });

  onwards('subjects', 'credentials');
}

// ---------------------------------------------------------------------------
// Step 6 — credentials
// ---------------------------------------------------------------------------

const credentialSchema = z.object({
  kind: z.enum(['degree', 'diploma', 'certificate', 'teaching_licence', 'id']),
  title: z.string().trim().min(2).max(200),
  institution: z.string().trim().min(2).max(200),
  year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
});

export async function addCredential(formData: FormData): Promise<void> {
  const { user, profile } = await editableTutor('credentials');

  const yearRaw = String(formData.get('year') ?? '').trim();
  const parsed = credentialSchema.safeParse({
    kind: formData.get('kind'),
    title: formData.get('title'),
    institution: formData.get('institution'),
    ...(yearRaw ? { year: yearRaw } : {}),
  });
  if (!parsed.success) backTo('credentials', 'Fill in the document type, title, institution and year.');

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) backTo('credentials', 'Attach the document.');

  const credentialId = randomUUID();
  const stored = await storeUpload('credential', file, (extension) =>
    credentialKey(user.id, credentialId, extension),
  );
  if ('error' in stored) backTo('credentials', stored.error);

  await db.transaction(async (tx) => {
    await tx.insert(credentials).values({
      id: credentialId,
      tutorId: user.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      institution: parsed.data.institution,
      year: parsed.data.year ?? null,
      fileKey: stored.key,
      status: 'pending',
    });

    await sendBackForReviewIfVerified(tx, user.id, profile.status);
  });

  revalidatePath(`${BASE}/credentials`);
  redirect(`${BASE}/credentials?saved=1`);
}

/**
 * A verified tutor who changes a document goes back into the queue.
 *
 * The document is the claim an admin actually checked, so changing one
 * invalidates that check. Everything else on the profile — bio, rates, hours —
 * a verified tutor edits freely without losing their place in the feed.
 */
async function sendBackForReviewIfVerified(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tutorId: string,
  status: TutorStatus,
): Promise<void> {
  if (!credentialChangeTriggersReview(status)) return;

  await tx
    .update(tutorProfiles)
    .set({
      status: transitionTutor(status, 'pending_review'),
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tutorProfiles.userId, tutorId));
}

export async function removeCredential(formData: FormData): Promise<void> {
  const { user, profile } = await editableTutor('credentials');
  const credentialId = String(formData.get('credentialId') ?? '');

  // Scoped to the caller: a tutor cannot delete somebody else's document.
  const [row] = await db
    .select({ fileKey: credentials.fileKey })
    .from(credentials)
    .where(and(eq(credentials.id, credentialId), eq(credentials.tutorId, user.id)))
    .limit(1);

  if (row) {
    await db.transaction(async (tx) => {
      await tx
        .delete(credentials)
        .where(and(eq(credentials.id, credentialId), eq(credentials.tutorId, user.id)));
      await sendBackForReviewIfVerified(tx, user.id, profile.status);
    });
    await getObjectStore().delete('private', row.fileKey);
  }

  revalidatePath(`${BASE}/credentials`);
  redirect(`${BASE}/credentials`);
}

// ---------------------------------------------------------------------------
// Step 7 — rates
// ---------------------------------------------------------------------------

export async function saveRates(formData: FormData): Promise<void> {
  const { user } = await editableTutor('rates');

  const hourlyCents = Math.round(Number(formData.get('hourly') ?? 0) * 100);
  const halfRaw = String(formData.get('halfHour') ?? '').trim();

  try {
    assertValidHourlyCents(hourlyCents);
  } catch {
    backTo('rates', 'Your hourly rate must be between $5.00 and $200.00.');
  }

  const halfHourCents = halfRaw ? Math.round(Number(halfRaw) * 100) : deriveHalfHourCents(hourlyCents);
  try {
    assertValidHalfHourCents(hourlyCents, halfHourCents);
  } catch {
    backTo('rates', 'Your 30-minute rate must be between 40% and 70% of your hourly rate.');
  }

  const offersTrial = formData.get('offersTrial') === 'on';
  const trialMinutes = Number(formData.get('trialMinutes') ?? 15);
  const maxTrialsPerWeek = Number(formData.get('maxTrialsPerWeek') ?? 5);

  await db
    .update(tutorProfiles)
    .set({
      hourlyCents,
      halfHourCents,
      offersTrial,
      trialMinutes: (TRIAL_MINUTE_OPTIONS as readonly number[]).includes(trialMinutes) ? trialMinutes : 15,
      maxTrialsPerWeek: Math.max(1, Math.min(30, Math.trunc(maxTrialsPerWeek) || 5)),
      updatedAt: new Date(),
    })
    .where(eq(tutorProfiles.userId, user.id));

  onwards('rates', 'availability');
}

// ---------------------------------------------------------------------------
// Step 8 — availability
// ---------------------------------------------------------------------------

export async function saveAvailability(formData: FormData): Promise<void> {
  const { user } = await editableTutor('availability');

  const [account] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const timezone = account?.timezone ?? 'UTC';
  const bufferMinutes = Number(formData.get('bufferMinutes') ?? 10);
  const rows: (typeof availabilityRules.$inferInsert)[] = [];

  // A reference week, used to turn "Monday 17:00 in my timezone" into the UTC
  // weekday and time the spec asks to store. The local copy is kept alongside —
  // see DECISIONS_NEEDED.md item 2.
  const reference = new Date();

  for (let weekdayLocal = 0; weekdayLocal < 7; weekdayLocal += 1) {
    const start = String(formData.get(`start:${weekdayLocal}`) ?? '').trim();
    const end = String(formData.get(`end:${weekdayLocal}`) ?? '').trim();
    if (!start || !end) continue;

    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    if (
      startHour === undefined ||
      endHour === undefined ||
      Number.isNaN(startHour) ||
      Number.isNaN(endHour)
    ) {
      continue;
    }
    if (endHour * 60 + (endMinute ?? 0) <= startHour * 60 + (startMinute ?? 0)) {
      backTo('availability', 'Each day must end after it starts.');
    }

    const referenceParts = getLocalParts(reference, timezone);
    const dayShift = (weekdayLocal - referenceParts.weekday + 7) % 7;
    const toUtc = (hour: number, minute: number) =>
      zonedTimeToUtc(
        {
          year: referenceParts.year,
          month: referenceParts.month,
          day: referenceParts.day + dayShift,
          hour,
          minute,
        },
        timezone,
      );

    const startUtc = toUtc(startHour, startMinute ?? 0);
    const endUtc = toUtc(endHour, endMinute ?? 0);

    rows.push({
      tutorId: user.id,
      weekday: startUtc.getUTCDay(),
      startTimeUtc: clockToString(startUtc.getUTCHours(), startUtc.getUTCMinutes()),
      endTimeUtc: clockToString(endUtc.getUTCHours(), endUtc.getUTCMinutes()),
      weekdayLocal,
      startTimeLocal: clockToString(startHour, startMinute ?? 0),
      endTimeLocal: clockToString(endHour, endMinute ?? 0),
      timezone,
      active: true,
    });
  }

  if (rows.length === 0) backTo('availability', 'Set hours on at least one day.');

  await db.transaction(async (tx) => {
    await tx.delete(availabilityRules).where(eq(availabilityRules.tutorId, user.id));
    await tx.insert(availabilityRules).values(rows);
    await tx
      .update(tutorProfiles)
      .set({
        bufferMinutes: (BUFFER_MINUTE_OPTIONS as readonly number[]).includes(bufferMinutes)
          ? bufferMinutes
          : 10,
        updatedAt: new Date(),
      })
      .where(eq(tutorProfiles.userId, user.id));
  });

  onwards('availability', 'payout');
}

/**
 * Time off: a blocked range (a single afternoon, or a fortnight away), or a
 * one-off extra window outside the weekly pattern (SPEC.md §5).
 *
 * Dates and times are entered in the tutor's own timezone and converted here,
 * so "away from the 12th to the 20th" means their days, not UTC ones.
 */
export async function addAvailabilityException(formData: FormData): Promise<void> {
  const { user } = await editableTutor('availability');

  const [account] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const timezone = account?.timezone ?? 'UTC';

  const kind = String(formData.get('kind') ?? 'block');
  if (kind !== 'block' && kind !== 'extra') backTo('availability', 'Choose whether to block time or add it.');

  const fromDate = String(formData.get('fromDate') ?? '').trim();
  const toDate = String(formData.get('toDate') ?? '').trim() || fromDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    backTo('availability', 'Pick the dates this applies to.');
  }

  const parseTime = (value: string, fallback: [number, number]): [number, number] => {
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    return match ? [Number(match[1]), Number(match[2])] : fallback;
  };

  // No times means whole days, which is what vacation mode is.
  const [fromHour, fromMinute] = parseTime(String(formData.get('fromTime') ?? ''), [0, 0]);
  const hasToTime = /^\d{1,2}:\d{2}$/.test(String(formData.get('toTime') ?? ''));
  const [toHour, toMinute] = parseTime(String(formData.get('toTime') ?? ''), [0, 0]);

  const [fromYear, fromMonth, fromDay] = fromDate.split('-').map(Number) as [number, number, number];
  const [toYear, toMonth, toDay] = toDate.split('-').map(Number) as [number, number, number];

  const startUtc = zonedTimeToUtc(
    { year: fromYear, month: fromMonth, day: fromDay, hour: fromHour, minute: fromMinute },
    timezone,
  );
  const endUtc = zonedTimeToUtc(
    hasToTime
      ? { year: toYear, month: toMonth, day: toDay, hour: toHour, minute: toMinute }
      : // Whole days: run to the start of the day after the last one.
        { year: toYear, month: toMonth, day: toDay + 1, hour: 0, minute: 0 },
    timezone,
  );

  if (endUtc <= startUtc) backTo('availability', 'That range ends before it starts.');

  await db.insert(availabilityExceptions).values({
    tutorId: user.id,
    date: fromDate,
    kind,
    startUtc,
    endUtc,
    note: String(formData.get('note') ?? '').trim().slice(0, 200) || null,
  });

  revalidatePath(`${BASE}/availability`);
  redirect(`${BASE}/availability?saved=1`);
}

export async function removeAvailabilityException(formData: FormData): Promise<void> {
  const { user } = await editableTutor('availability');
  const id = String(formData.get('exceptionId') ?? '');

  // Scoped to the caller, so a tutor cannot delete somebody else's time off.
  await db
    .delete(availabilityExceptions)
    .where(and(eq(availabilityExceptions.id, id), eq(availabilityExceptions.tutorId, user.id)));

  revalidatePath(`${BASE}/availability`);
  redirect(`${BASE}/availability`);
}

// ---------------------------------------------------------------------------
// Step 9 — payout details (deferrable)
// ---------------------------------------------------------------------------

const payoutSchema = z.object({
  accountTitle: z.string().trim().min(2).max(200),
  bankName: z.string().trim().min(2).max(200),
  country: z.string().trim().length(2),
  accountNumber: z.string().trim().min(6).max(64),
  swift: z.string().trim().max(32).optional(),
  cnic: z.string().trim().max(32).optional(),
});

export async function savePayoutMethod(formData: FormData): Promise<void> {
  const { user } = await editableTutor('payout');

  const parsed = payoutSchema.safeParse({
    accountTitle: formData.get('accountTitle'),
    bankName: formData.get('bankName'),
    country: formData.get('country'),
    accountNumber: formData.get('accountNumber'),
    swift: String(formData.get('swift') ?? '').trim() || undefined,
    cnic: String(formData.get('cnic') ?? '').trim() || undefined,
  });
  if (!parsed.success) backTo('payout', 'Fill in the account title, bank, country and account number.');

  const { accountNumber, swift, cnic } = parsed.data;

  await db.transaction(async (tx) => {
    // One default method per tutor for now; replacing it drops the old row.
    await tx.delete(payoutMethods).where(eq(payoutMethods.tutorId, user.id));
    await tx.insert(payoutMethods).values({
      tutorId: user.id,
      accountTitle: parsed.data.accountTitle,
      bankName: parsed.data.bankName,
      country: parsed.data.country.toUpperCase(),
      // Encrypted by the application, never stored or logged in the clear.
      accountNumberEnc: encryptSecret(accountNumber),
      swiftEnc: swift ? encryptSecret(swift) : null,
      cnicEnc: cnic ? encryptSecret(cnic) : null,
      last4: last4(accountNumber),
      isDefault: true,
    });
  });

  onwards('payout', 'review');
}

// ---------------------------------------------------------------------------
// Step 10 — submit
// ---------------------------------------------------------------------------

export async function submitProfile(): Promise<void> {
  const user = await requireRole('tutor');

  try {
    await submitForReview(user.id);
  } catch (error) {
    const message =
      error instanceof VerificationError ? error.message : 'Could not submit your profile. Try again.';
    backTo('review', message);
  }

  revalidatePath('/tutor');
  redirect('/tutor?submitted=1');
}

export async function withdrawProfile(): Promise<void> {
  const user = await requireRole('tutor');

  try {
    await withdrawSubmission(user.id);
  } catch {
    redirect('/tutor?error=withdraw');
  }

  revalidatePath('/tutor');
  redirect(`${BASE}/review`);
}
