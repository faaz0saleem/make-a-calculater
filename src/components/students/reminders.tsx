/**
 * "Text me before my lesson."
 *
 * This is the phone-number field, and it is deliberately not called that. A
 * phone number is something a student gives us; a reminder is something they
 * get. Same column, opposite feeling — and the difference between the two
 * framings is most of the difference in how many people fill it in.
 *
 * It appears once there is a lesson to be reminded about, which is also when it
 * is worth anything. It is never required and never blocks a booking.
 */

import { saveReminderPreference } from '@/app/students/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function ReminderPreference({
  phone,
  returnTo,
  saved,
  error,
}: {
  phone: string | null;
  returnTo: string;
  saved?: boolean;
  error?: boolean;
}) {
  return (
    <Card data-testid="reminder-preference">
      <CardHeader>
        <CardTitle as="h2">WhatsApp reminders</CardTitle>
        <CardDescription>
          {phone
            ? 'We will message you an hour before each lesson and if a tutor moves one.'
            : 'Give us a number and we will message you an hour before each lesson, and straight away if a tutor moves one. Nothing else — no marketing.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {saved ? (
          <p role="status" className="mb-3 rounded-md bg-[var(--success)]/10 px-3 py-2 text-sm">
            Saved. {phone ? `We will message ${phone}.` : 'Reminders are off.'}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mb-3 text-sm text-[var(--destructive)]">
            That does not look like a phone number. Include the country code if you can.
          </p>
        ) : null}

        <form action={saveReminderPreference} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="returnTo" value={returnTo} />

          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="phone">
              Mobile number
            </label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+92 300 1234567"
              defaultValue={phone ?? ''}
              maxLength={32}
            />
          </div>

          <Button type="submit" variant="outline" className="min-h-11">
            {phone ? 'Update' : 'Send me reminders'}
          </Button>
        </form>

        <p className="mt-2 text-xs text-muted-foreground">
          Optional. Leave it blank and you will still get everything in the app.
        </p>
      </CardContent>
    </Card>
  );
}
