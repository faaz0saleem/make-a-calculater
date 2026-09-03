/**
 * Steps 8 to 10: availability, payout details and submission.
 */

import Link from 'next/link';

import {
  addAvailabilityException,
  removeAvailabilityException,
  savePayoutMethod,
  saveAvailability,
  submitProfile,
} from '@/app/tutor/onboarding/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Select } from '@/components/ui/select';
import { PAYOUT_THRESHOLD_CENTS } from '@/lib/money/payouts';
import { formatCents } from '@/lib/money/cents';
import { formatInTimeZone } from '@/lib/time';
import { BUFFER_MINUTE_OPTIONS, type WizardProgress } from '@/lib/tutors/wizard';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function AvailabilityStep({
  timezone,
  bufferMinutes,
  rules,
  exceptions,
}: {
  timezone: string;
  bufferMinutes: number;
  rules: { weekdayLocal: number; startTimeLocal: string; endTimeLocal: string }[];
  exceptions: {
    id: string;
    kind: 'block' | 'extra';
    startUtc: Date;
    endUtc: Date;
    note: string | null;
  }[];
}) {
  const byWeekday = new Map(rules.map((rule) => [rule.weekdayLocal, rule]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-8">
    <form action={saveAvailability} className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        These are the hours you teach, in <strong>{timezone}</strong>. Students see them converted into their
        own timezone. Leave a day blank to take it off.
      </p>

      <div className="flex flex-col gap-2">
        {WEEKDAYS.map((label, weekday) => {
          const rule = byWeekday.get(weekday);
          return (
            <div key={label} className="grid items-center gap-3 rounded-md border border-border px-3 py-2 sm:grid-cols-[8rem_1fr_1fr]">
              <span className="text-sm font-medium">{label}</span>
              <Field label="" htmlFor={`start:${weekday}`}>
                <Input
                  id={`start:${weekday}`}
                  name={`start:${weekday}`}
                  type="time"
                  step={1800}
                  defaultValue={rule?.startTimeLocal.slice(0, 5) ?? ''}
                  aria-label={`${label} start`}
                  className="h-9"
                />
              </Field>
              <Field label="" htmlFor={`end:${weekday}`}>
                <Input
                  id={`end:${weekday}`}
                  name={`end:${weekday}`}
                  type="time"
                  step={1800}
                  defaultValue={rule?.endTimeLocal.slice(0, 5) ?? ''}
                  aria-label={`${label} end`}
                  className="h-9"
                />
              </Field>
            </div>
          );
        })}
      </div>

      <Field label="Gap between sessions" htmlFor="bufferMinutes" hint="Time to write notes and get a drink.">
        <Select id="bufferMinutes" name="bufferMinutes" defaultValue={String(bufferMinutes)} className="max-w-40">
          {BUFFER_MINUTE_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0 ? 'No gap' : `${minutes} minutes`}
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" className="self-start">
        Save and continue
      </Button>
    </form>

    {/* ------------------------------------------------------------------ */}
    {/* Time off and one-off extras (SPEC.md §5)                            */}
    {/* ------------------------------------------------------------------ */}
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <div>
        <h3 className="text-sm font-medium">Time off and extra hours</h3>
        <p className="text-xs text-muted-foreground">
          Block a holiday or an afternoon, or open up time outside your usual week. Dates are in{' '}
          {timezone}.
        </p>
      </div>

      {exceptions.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
          {exceptions.map((exception) => (
            <li key={exception.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <p className="font-medium">
                  {formatInTimeZone(exception.startUtc, timezone, { dateStyle: 'medium', timeStyle: 'short' })}
                  {' → '}
                  {formatInTimeZone(exception.endUtc, timezone, { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                {exception.note ? <p className="text-muted-foreground">{exception.note}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={exception.kind === 'block' ? 'destructive' : 'success'}>
                  {exception.kind === 'block' ? 'Blocked' : 'Extra'}
                </Badge>
                <form action={removeAvailabilityException}>
                  <input type="hidden" name="exceptionId" value={exception.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Remove
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          Nothing blocked. Your weekly hours apply as they are.
        </p>
      )}

      <form action={addAvailabilityException} className="flex flex-col gap-4 rounded-md border border-border p-4">
        <Field label="What is this?" htmlFor="kind">
          <Select id="kind" name="kind" defaultValue="block" className="max-w-64">
            <option value="block">Block time off</option>
            <option value="extra">Add extra hours</option>
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" htmlFor="fromDate">
            <div className="flex gap-2">
              <Input id="fromDate" name="fromDate" type="date" min={today} required />
              <Input name="fromTime" type="time" step={1800} aria-label="Start time" className="max-w-32" />
            </div>
          </Field>
          <Field label="To" htmlFor="toDate" hint="Leave the times blank to cover whole days.">
            <div className="flex gap-2">
              <Input id="toDate" name="toDate" type="date" min={today} />
              <Input name="toTime" type="time" step={1800} aria-label="End time" className="max-w-32" />
            </div>
          </Field>
        </div>

        <Field label="Note" htmlFor="note" hint="Only you see this.">
          <Input id="note" name="note" maxLength={200} placeholder="Away / exam week / extra revision hours" />
        </Field>

        <Button type="submit" variant="outline" className="self-start">
          Add
        </Button>
      </form>
    </section>
    </div>
  );
}

export function PayoutStep({
  method,
  country,
}: {
  method: { accountTitle: string; bankName: string; country: string; last4: string } | null;
  country: string | null;
}) {
  return (
    <form action={savePayoutMethod} className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Optional for now — you can add this later, and you will need it before your first payout at{' '}
        {formatCents(PAYOUT_THRESHOLD_CENTS)}. Your account number is encrypted before it is stored; only the
        last four digits are ever shown back to you.
      </p>

      {method ? (
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{method.accountTitle}</p>
            <p className="text-muted-foreground">
              {method.bankName} · {method.country} · ····{method.last4}
            </p>
          </div>
          <Badge variant="secondary">On file</Badge>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account title" htmlFor="accountTitle" hint="Exactly as your bank has it.">
          <Input id="accountTitle" name="accountTitle" defaultValue={method?.accountTitle ?? ''} required />
        </Field>
        <Field label="Bank name" htmlFor="bankName">
          <Input id="bankName" name="bankName" defaultValue={method?.bankName ?? ''} required />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bank country" htmlFor="country" hint="Two-letter code.">
          <Input
            id="country"
            name="country"
            defaultValue={method?.country ?? country ?? ''}
            required
            minLength={2}
            maxLength={2}
            className="uppercase"
          />
        </Field>
        <Field label="IBAN or account number" htmlFor="accountNumber">
          <Input id="accountNumber" name="accountNumber" required minLength={6} maxLength={64} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SWIFT / BIC" htmlFor="swift" hint="Needed for international transfers.">
          <Input id="swift" name="swift" maxLength={32} />
        </Field>
        <Field label="CNIC" htmlFor="cnic" hint="Optional, Pakistan-domiciled tutors only.">
          <Input id="cnic" name="cnic" maxLength={32} />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit">Save and continue</Button>
        <Link href="/tutor/onboarding/review" className="text-sm text-muted-foreground underline underline-offset-4">
          Skip for now
        </Link>
      </div>
    </form>
  );
}

export function ReviewStep({
  progress,
  status,
  rejectionReason,
}: {
  progress: WizardProgress;
  status: string;
  rejectionReason: string | null;
}) {
  if (status === 'pending_review') {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p className="rounded-md bg-secondary px-3 py-2">
          Your profile is with our review team. We look at every submission by hand, usually within a day.
        </p>
        <p className="text-muted-foreground">
          Need to change something? Withdraw it from your{' '}
          <Link href="/tutor" className="underline underline-offset-4">
            teaching page
          </Link>
          , edit, and submit again.
        </p>
      </div>
    );
  }

  if (status === 'verified') {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p className="rounded-md bg-[var(--success)]/10 px-3 py-2 text-[var(--success)]">
          You are verified. Your profile is live in the feed.
        </p>
        <Link href="/tutor" className="underline underline-offset-4">
          Go to your teaching page
        </Link>
      </div>
    );
  }

  return (
    <form action={submitProfile} className="flex flex-col gap-5">
      {rejectionReason ? (
        <div className="rounded-md bg-destructive/10 px-3 py-3 text-sm">
          <p className="font-medium text-destructive">Your last submission was not accepted</p>
          <p className="mt-1 text-destructive">{rejectionReason}</p>
          <p className="mt-2 text-muted-foreground">Fix this and submit again — there is no limit on attempts.</p>
        </div>
      ) : null}

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
        {progress.steps
          .filter((step) => step.slug !== 'review')
          .map((step) => (
            <li key={step.slug} className="flex items-center justify-between gap-3 px-3 py-2">
              <Link href={`/tutor/onboarding/${step.slug}`} className="hover:underline">
                {step.number}. {step.title}
              </Link>
              {step.state === 'complete' ? (
                <Badge variant="success">Done</Badge>
              ) : step.optional ? (
                <Badge variant="outline">Optional</Badge>
              ) : (
                <Badge variant="destructive">Needed</Badge>
              )}
            </li>
          ))}
      </ul>

      {progress.canSubmit ? (
        <>
          <p className="text-sm text-muted-foreground">
            Submitting locks your profile while an admin reads it. You can withdraw it at any time to keep
            editing.
          </p>
          <Button type="submit" size="lg" className="self-start">
            Submit for review
          </Button>
        </>
      ) : (
        <p className="rounded-md bg-secondary px-3 py-2 text-sm">
          Finish {progress.blocking.map((step) => step.title).join(', ')} before submitting.
        </p>
      )}
    </form>
  );
}
