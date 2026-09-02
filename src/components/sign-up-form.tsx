'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Intent = 'student' | 'tutor';

export function SignUpForm() {
  const [intent, setIntent] = useState<Intent>('student');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name') ?? ''),
        email,
        password,
        intent,
        // The browser knows the visitor's zone; the server validates it.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });

    if (!response.ok) {
      const body: { error?: string } = await response.json().catch(() => ({}));
      setError(body.error ?? 'Something went wrong. Try again.');
      setBusy(false);
      return;
    }

    await signIn('credentials', { email, password, redirectTo: intent === 'tutor' ? '/tutor' : '/dashboard' });
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <div className="grid grid-cols-2 gap-2">
        {(['student', 'tutor'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setIntent(option)}
            className={`rounded-md border px-3 py-2 text-sm capitalize transition-colors ${
              intent === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
            }`}
          >
            {option === 'student' ? 'I want to learn' : 'I want to teach'}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <label className="text-sm font-medium" htmlFor="name">
        Full name
      </label>
      <Input id="name" name="name" required minLength={2} autoComplete="name" />

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

      <Button type="submit" className="mt-2" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
