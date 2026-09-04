'use client';

/**
 * Signing up.
 *
 * A student is asked for three things: an email, a password, and whether they
 * are 18 or over. That last one is not a field we could have deferred like the
 * others — the answer changes what we are legally allowed to do with the
 * account from the first minute — and it is the only reason this form has a
 * third control at all.
 *
 * Timezone and country are **inferred and shown, never asked**. The browser
 * already knows both; asking costs a visitor two decisions to tell us something
 * we have. What we owe them is visibility and a way to correct it, which is the
 * disclosure below the fold rather than two more required selects.
 *
 * A name is not asked for. A student gives one on the booking form, where the
 * tutor obviously needs it. A tutor gives one here, because the verification
 * wizard is built around it and signing up to teach is a more committed act.
 */

import { signIn } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { countryName, countryOptions, inferPlace } from '@/lib/geo/infer';

type Intent = 'student' | 'tutor';

/** Carries the answers Google's round trip would otherwise lose. */
export const SIGNUP_HINT_COOKIE = 'tutorly_signup';

export function SignUpForm({
  googleEnabled,
  next,
}: {
  googleEnabled: boolean;
  /** Where they were going — a held slot, usually. Validated by the caller. */
  next?: string | null;
}) {
  const [intent, setIntent] = useState<Intent>('student');
  const [isAdult, setIsAdult] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Read once on mount: the server render has no browser to ask.
  const [place, setPlace] = useState(() => inferPlace(null));
  const [country, setCountry] = useState<string>('');
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    const detected = inferPlace(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setPlace(detected);
    setCountry(detected.country ?? '');
  }, []);

  const countries = useMemo(() => countryOptions(), []);
  const placeLabel = countryName(country) ?? 'somewhere we could not work out';

  function stashForGoogle() {
    // Google's round trip goes through their servers and comes back with only
    // an email. The answers this form collected ride along in a short-lived
    // cookie and are applied when the account row is created.
    const hint = JSON.stringify({ isAdult, intent, timezone: place.timezone, country });
    document.cookie = `${SIGNUP_HINT_COOKIE}=${encodeURIComponent(hint)}; path=/; max-age=900; samesite=lax`;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isAdult === null) {
      setError('Let us know whether you are 18 or over.');
      return;
    }

    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: intent === 'tutor' ? String(form.get('name') ?? '') : undefined,
        email,
        password,
        intent,
        isAdult,
        timezone: place.timezone,
        country: country || undefined,
      }),
    });

    if (!response.ok) {
      const body: { error?: string } = await response.json().catch(() => ({}));
      setError(body.error ?? 'Something went wrong. Try again.');
      setBusy(false);
      return;
    }

    // Through the landing route, which claims the slot they held before they
    // had an account and then sends them on to it.
    const destination = next ?? (intent === 'tutor' ? '/tutor' : '/');
    await signIn('credentials', {
      email,
      password,
      redirectTo: `/api/auth/land?next=${encodeURIComponent(destination)}`,
    });
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <div className="grid grid-cols-2 gap-2">
        {(['student', 'tutor'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setIntent(option)}
            aria-pressed={intent === option}
            className={`rounded-md border px-3 py-2 text-sm transition-colors ${
              intent === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
            }`}
          >
            {option === 'student' ? 'I want to learn' : 'I want to teach'}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {intent === 'tutor' ? (
        <>
          <label className="text-sm font-medium" htmlFor="name">
            Full name
          </label>
          <Input id="name" name="name" required minLength={2} autoComplete="name" />
        </>
      ) : null}

      <label className="text-sm font-medium" htmlFor="email">
        Email
      </label>
      <Input id="email" name="email" type="email" required autoComplete="email" />

      <label className="text-sm font-medium" htmlFor="password">
        Password
      </label>
      <Input id="password" name="password" type="password" required autoComplete="new-password" />
      <p className="text-xs text-muted-foreground">
        At least 10 characters, with a letter and a number.
      </p>

      <fieldset className="mt-1 flex flex-col gap-2" data-testid="age-question">
        <legend className="text-sm font-medium">Are you 18 or over?</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
          ].map((option) => (
            <label
              key={option.label}
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${
                isAdult === option.value ? 'border-primary' : 'border-border'
              }`}
            >
              <input
                type="radio"
                name="isAdult"
                value={String(option.value)}
                checked={isAdult === option.value}
                onChange={() => setIsAdult(option.value)}
                required
                className="size-4"
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {isAdult === false
            ? 'That is fine — you can browse and book. We will ask for a parent or guardian’s email when you book your first lesson.'
            : 'We ask because it changes what we are allowed to do with your account. Nothing else on this page is required.'}
        </p>
      </fieldset>

      <Button type="submit" className="mt-2" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account'}
      </Button>

      {googleEnabled ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy || isAdult === null}
          onClick={() => {
            stashForGoogle();
            const destination = next ?? (intent === 'tutor' ? '/tutor' : '/');
            void signIn('google', {
              redirectTo: `/api/auth/land?next=${encodeURIComponent(destination)}`,
            });
          }}
        >
          Continue with Google
        </Button>
      ) : null}

      <div className="mt-1 rounded-md border border-border px-3 py-2 text-xs" data-testid="inferred-place">
        <p className="text-muted-foreground">
          We have set your timezone to <strong className="text-foreground">{place.timezone}</strong>
          {country ? (
            <>
              {' '}
              and your country to <strong className="text-foreground">{placeLabel}</strong>
            </>
          ) : null}
          , from your browser. Times are shown in it.{' '}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => setCorrecting((open) => !open)}
          >
            {correcting ? 'Never mind' : 'Not right?'}
          </button>
        </p>

        {correcting ? (
          <div className="mt-2 flex flex-col gap-1">
            <label className="font-medium" htmlFor="country">
              Country
            </label>
            <Select
              id="country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="h-9 text-xs"
            >
              <option value="">Prefer not to say</option>
              {countries.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </Select>
            <p className="text-muted-foreground">
              Only decides which exam boards and payment methods are shown first. You can change it
              later.
            </p>
          </div>
        ) : null}
      </div>
    </form>
  );
}
