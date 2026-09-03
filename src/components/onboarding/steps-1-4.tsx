/**
 * Steps 1 to 4 of the wizard: account, identity, profile and intro video.
 *
 * Plain server-rendered forms posting to server actions, so they work with no
 * JavaScript and every submit is a draft save.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { saveIdentity, saveProfile, uploadIntroVideo } from '@/app/tutor/onboarding/actions';
import { LANGUAGES, LANGUAGE_PROFICIENCIES, PROFICIENCY_LABELS } from '@/lib/tutors/languages';
import {
  BIO_MAX,
  BIO_MIN,
  HEADLINE_MAX,
  INTRO_VIDEO_MAX_SECONDS,
  INTRO_VIDEO_MIN_SECONDS,
} from '@/lib/tutors/wizard';
import { UPLOAD_RULES } from '@/lib/storage/uploads';

/** A short list of the zones tutors actually pick, plus whatever they already have. */
const COMMON_TIMEZONES = [
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Manila',
  'Europe/London',
  'Europe/Berlin',
  'Africa/Lagos',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

export function AccountStep({ email, emailVerified }: { email: string; emailVerified: boolean }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <span>{email}</span>
        {emailVerified ? (
          <Badge variant="success">Verified</Badge>
        ) : (
          <Badge variant="secondary">Unverified</Badge>
        )}
      </div>
      <p className="text-muted-foreground">
        {emailVerified
          ? 'Your account is ready. Move on to your identity.'
          : 'Verification emails are sent once the email provider is wired up in Phase 7. Seeded accounts are already verified.'}
      </p>
    </div>
  );
}

export function IdentityStep({
  name,
  country,
  city,
  timezone,
  languages,
}: {
  name: string;
  country: string | null;
  city: string | null;
  timezone: string;
  languages: { languageCode: string; proficiency: string }[];
}) {
  const chosen = new Map(languages.map((language) => [language.languageCode, language.proficiency]));
  const zones = COMMON_TIMEZONES.includes(timezone) ? COMMON_TIMEZONES : [timezone, ...COMMON_TIMEZONES];

  return (
    <form action={saveIdentity} className="flex flex-col gap-5">
      <Field label="Full name" htmlFor="name">
        <Input id="name" name="name" defaultValue={name} required minLength={2} maxLength={120} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" htmlFor="country" hint="Two-letter code, e.g. PK">
          <Input
            id="country"
            name="country"
            defaultValue={country ?? ''}
            required
            minLength={2}
            maxLength={2}
            className="uppercase"
          />
        </Field>
        <Field label="City" htmlFor="city">
          <Input id="city" name="city" defaultValue={city ?? ''} required maxLength={120} />
        </Field>
      </div>

      <Field label="Timezone" htmlFor="timezone" hint="Students see your slots converted into their own timezone.">
        <Select id="timezone" name="timezone" defaultValue={timezone}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Languages you teach in</legend>
        <p className="text-xs text-muted-foreground">
          Set a level for each language you teach in, and leave the rest on &ldquo;Not taught&rdquo;.
        </p>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {LANGUAGES.map((language) => (
            <label
              key={language.code}
              htmlFor={`language:${language.code}`}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="flex-1">{language.name}</span>
              <Select
                id={`language:${language.code}`}
                name={`language:${language.code}`}
                defaultValue={chosen.get(language.code) ?? ''}
                className="h-8 w-36 text-xs"
              >
                <option value="">Not taught</option>
                {LANGUAGE_PROFICIENCIES.map((proficiency) => (
                  <option key={proficiency} value={proficiency}>
                    {PROFICIENCY_LABELS[proficiency]}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" className="self-start">
        Save and continue
      </Button>
    </form>
  );
}

export function ProfileStep({
  headline,
  bio,
  avatarUrl,
}: {
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
}) {
  return (
    <form action={saveProfile} className="flex flex-col gap-5">
      <Field label="Headline" htmlFor="headline" hint={`Up to ${HEADLINE_MAX} characters. This sits under your name in the feed.`}>
        <Input
          id="headline"
          name="headline"
          defaultValue={headline ?? ''}
          required
          maxLength={HEADLINE_MAX}
          placeholder="Exam-focused physics tutor — 8 years, 900+ hours"
        />
      </Field>

      <Field label="Bio" htmlFor="bio" hint={`Between ${BIO_MIN} and ${BIO_MAX} characters.`}>
        <Textarea
          id="bio"
          name="bio"
          defaultValue={bio ?? ''}
          required
          minLength={BIO_MIN}
          maxLength={BIO_MAX}
          rows={8}
          placeholder="What you teach, who you teach, and what a lesson with you is actually like."
        />
      </Field>

      <Field label="Profile photo" htmlFor="photo" hint={`Upload ${UPLOAD_RULES.avatar.label}.`}>
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="size-12 rounded-full border border-border object-cover" />
          ) : (
            <span className="size-12 rounded-full bg-secondary" aria-hidden />
          )}
          <Input id="photo" name="photo" type="file" accept={UPLOAD_RULES.avatar.contentTypes.join(',')} />
        </div>
      </Field>

      <Button type="submit" className="self-start">
        Save and continue
      </Button>
    </form>
  );
}

export function VideoStep({
  hasVideo,
  videoUrl,
  durationS,
}: {
  hasVideo: boolean;
  videoUrl: string | null;
  durationS: number | null;
}) {
  return (
    <form action={uploadIntroVideo} className="flex flex-col gap-5">
      {hasVideo && videoUrl ? (
        <div className="flex flex-col gap-2">
          <video controls src={videoUrl} className="w-full max-w-md rounded-md border border-border" />
          <p className="text-xs text-muted-foreground">
            {durationS ? `${durationS} seconds.` : 'Length is measured when transcoding lands in Phase 2.'}{' '}
            Uploading another file replaces this one.
          </p>
        </div>
      ) : null}

      <Field
        label="Intro video"
        htmlFor="video"
        hint={`${INTRO_VIDEO_MIN_SECONDS}–${INTRO_VIDEO_MAX_SECONDS} seconds. Upload ${UPLOAD_RULES.introVideo.label}.`}
      >
        <Input id="video" name="video" type="file" accept={UPLOAD_RULES.introVideo.contentTypes.join(',')} required />
      </Field>

      <p className="text-sm text-muted-foreground">
        Say who you teach, what a lesson looks like, and why a student should pick you. This is the first
        thing anyone sees.
      </p>

      <Button type="submit" className="self-start">
        Upload and continue
      </Button>
    </form>
  );
}
