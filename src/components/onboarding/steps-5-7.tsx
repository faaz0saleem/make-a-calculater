/**
 * Steps 5 to 7: subjects, credentials and rates.
 */

import { addCredential, removeCredential, saveRates, saveSubjects } from '@/app/tutor/onboarding/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Select } from '@/components/ui/select';
import { formatCents } from '@/lib/money/cents';
import { deriveHalfHourCents, halfHourBand, HOURLY_CEILING_CENTS, HOURLY_FLOOR_CENTS } from '@/lib/money/pricing';
import { UPLOAD_RULES } from '@/lib/storage/uploads';
import { MAX_SUBJECTS, TRIAL_MINUTE_OPTIONS } from '@/lib/tutors/wizard';

const LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'exam_prep', label: 'Exam prep' },
] as const;

const CREDENTIAL_KINDS = [
  { value: 'degree', label: 'Degree' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'teaching_licence', label: 'Teaching licence' },
  { value: 'id', label: 'Identity document' },
] as const;

export function SubjectsStep({
  subjects,
  chosen,
}: {
  subjects: { id: string; name: string }[];
  chosen: { subjectId: string; level: string; yearsExperience: number }[];
}) {
  const chosenById = new Map(chosen.map((row) => [row.subjectId, row]));

  return (
    <form action={saveSubjects} className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Pick up to {MAX_SUBJECTS}. Students filter by these, so only tick what you would genuinely teach at
        the level you claim.
      </p>

      <div className="flex flex-col gap-2">
        {subjects.map((subject) => {
          const existing = chosenById.get(subject.id);
          return (
            <div
              key={subject.id}
              className="grid items-center gap-3 rounded-md border border-border px-3 py-2 sm:grid-cols-[1.5fr_1fr_7rem]"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="subject"
                  value={subject.id}
                  defaultChecked={Boolean(existing)}
                  className="size-4"
                />
                {subject.name}
              </label>

              <Select name={`level:${subject.id}`} defaultValue={existing?.level ?? 'intermediate'} className="h-9 text-xs">
                {LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </Select>

              <Input
                type="number"
                name={`years:${subject.id}`}
                defaultValue={existing?.yearsExperience ?? 1}
                min={0}
                max={60}
                aria-label={`Years teaching ${subject.name}`}
                className="h-9 text-xs"
              />
            </div>
          );
        })}
      </div>

      <Button type="submit" className="self-start">
        Save and continue
      </Button>
    </form>
  );
}

export function CredentialsStep({
  documents,
}: {
  documents: { id: string; kind: string; title: string; institution: string; year: number | null; status: string }[];
}) {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        At least one document. Files go straight to a private bucket — students never see them, and our
        review team opens each one through a link that expires after 60 seconds.
      </p>

      {documents.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{document.title}</p>
                <p className="text-muted-foreground">
                  {document.institution}
                  {document.year ? ` · ${document.year}` : ''} · {document.kind.replace('_', ' ')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={document.status === 'approved' ? 'success' : 'secondary'}>
                  {document.status}
                </Badge>
                <form action={removeCredential}>
                  <input type="hidden" name="credentialId" value={document.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Remove
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No documents yet.
        </p>
      )}

      <form action={addCredential} className="flex flex-col gap-4 rounded-md border border-border p-4">
        <p className="text-sm font-medium">Add a document</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="kind">
            <Select id="kind" name="kind" defaultValue="degree">
              {CREDENTIAL_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" htmlFor="year">
            <Input id="year" name="year" type="number" min={1950} max={currentYear + 1} placeholder={String(currentYear)} />
          </Field>
        </div>

        <Field label="Title" htmlFor="title" hint="What the document says, e.g. BSc Mathematics.">
          <Input id="title" name="title" required minLength={2} maxLength={200} />
        </Field>

        <Field label="Institution" htmlFor="institution">
          <Input id="institution" name="institution" required minLength={2} maxLength={200} />
        </Field>

        <Field label="File" htmlFor="file" hint={`Upload ${UPLOAD_RULES.credential.label}.`}>
          <Input id="file" name="file" type="file" accept={UPLOAD_RULES.credential.contentTypes.join(',')} required />
        </Field>

        <Button type="submit" className="self-start">
          Upload document
        </Button>
      </form>
    </div>
  );
}

export function RatesStep({
  hourlyCents,
  halfHourCents,
  offersTrial,
  trialMinutes,
  maxTrialsPerWeek,
}: {
  hourlyCents: number;
  halfHourCents: number;
  offersTrial: boolean;
  trialMinutes: number;
  maxTrialsPerWeek: number;
}) {
  const band = halfHourBand(hourlyCents);

  return (
    <form action={saveRates} className="flex flex-col gap-5">
      <Field
        label="60-minute rate"
        htmlFor="hourly"
        hint={`Between ${formatCents(HOURLY_FLOOR_CENTS)} and ${formatCents(HOURLY_CEILING_CENTS)}.`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            id="hourly"
            name="hourly"
            type="number"
            step="0.01"
            min={HOURLY_FLOOR_CENTS / 100}
            max={HOURLY_CEILING_CENTS / 100}
            defaultValue={(hourlyCents / 100).toFixed(2)}
            required
          />
        </div>
      </Field>

      <Field
        label="30-minute rate"
        htmlFor="halfHour"
        hint={`Leave blank to use ${formatCents(deriveHalfHourCents(hourlyCents))}. Must sit between ${formatCents(band.minCents)} and ${formatCents(band.maxCents)} — 40% to 70% of your hourly rate.`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            id="halfHour"
            name="halfHour"
            type="number"
            step="0.01"
            defaultValue={(halfHourCents / 100).toFixed(2)}
          />
        </div>
      </Field>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="offersTrial" defaultChecked={offersTrial} className="size-4" />
          Offer a free trial
        </label>
        <p className="text-xs text-muted-foreground">
          Trials convert browsers into students. You approve each request by hand, and they move no credits.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trial length" htmlFor="trialMinutes">
            <Select id="trialMinutes" name="trialMinutes" defaultValue={String(trialMinutes)}>
              {TRIAL_MINUTE_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Trials per week" htmlFor="maxTrialsPerWeek" hint="So trials cannot eat your calendar.">
            <Input
              id="maxTrialsPerWeek"
              name="maxTrialsPerWeek"
              type="number"
              min={1}
              max={30}
              defaultValue={maxTrialsPerWeek}
            />
          </Field>
        </div>
      </fieldset>

      <Button type="submit" className="self-start">
        Save and continue
      </Button>
    </form>
  );
}
