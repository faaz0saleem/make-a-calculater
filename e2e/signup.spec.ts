/**
 * Phase 6 Part B: what signup asks, and what it does not.
 *
 * The claim under test is a number: **a new visitor reaches a browsable feed in
 * under ten seconds and under three interactions.** Everything else in this
 * file exists because the way to hit that number is to stop asking questions,
 * and each question removed has to land somewhere better instead.
 */

import { expect, test } from '@playwright/test';

import { ACCOUNTS, queryDatabase, SEED_PASSWORD, signIn, signOut } from './helpers';

test.describe.configure({ mode: 'serial' });

/** A fresh address per run, so a re-run does not collide with itself. */
function newEmail(prefix: string): string {
  return `${prefix}.${Date.now().toString(36)}@example.test`;
}

test('a new visitor reaches a browsable feed in under 10 seconds and under 3 interactions', async ({
  page,
}) => {
  await signOut(page);

  let interactions = 0;
  // Every click and every key press the visitor makes, counted by the browser
  // rather than by us remembering to increment something.
  await page.addInitScript(() => {
    (window as unknown as { __interactions: number }).__interactions = 0;
    for (const type of ['click', 'keydown', 'submit'] as const) {
      window.addEventListener(
        type,
        () => {
          (window as unknown as { __interactions: number }).__interactions += 1;
        },
        { capture: true },
      );
    }
  });

  const started = Date.now();
  await page.goto('/');

  // A browsable feed: real tutors, with prices, that can be opened.
  const cards = page.getByTestId('tutor-card');
  await expect(cards.first()).toBeVisible();
  await expect(page.getByTestId('card-price').first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(5);

  const elapsedMs = Date.now() - started;
  interactions = await page.evaluate(
    () => (window as unknown as { __interactions: number }).__interactions,
  );

  expect(interactions, 'a visitor should not have to press anything to browse').toBeLessThan(3);
  expect(elapsedMs, `feed took ${elapsedMs}ms`).toBeLessThan(10_000);
});

test('signup asks three things, and infers the rest', async ({ page }) => {
  await signOut(page);
  await page.goto('/signup');

  // Email, password, and whether they are 18 or over. No name, no country, no
  // timezone, no class.
  const inputs = await page
    .locator('form input:not([type="hidden"]):not([type="radio"])')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).name));
  expect(inputs.sort()).toEqual(['email', 'password']);

  await expect(page.getByTestId('age-question')).toBeVisible();

  // Timezone and country are shown, not asked.
  const inferred = page.getByTestId('inferred-place');
  await expect(inferred).toContainText('We have set your timezone to');
  await expect(inferred.getByRole('button', { name: 'Not right?' })).toBeVisible();
});

test('an adult signs up with an email, a password and one answer', async ({ page }) => {
  const email = newEmail('adult');

  await signOut(page);
  await page.goto('/signup');

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('radio', { name: 'Yes' }).check();
  await page.getByRole('button', { name: 'Create account' }).click();

  // Lands on the feed, not on a wizard.
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByTestId('tutor-card').first()).toBeVisible();

  const [row] = await queryDatabase<
    { is_adult: boolean; name: string; confirmed: string | null; timezone: string; country: string }[]
  >(
    (sql) => sql`
      select is_adult, name, name_confirmed_at::text as confirmed, timezone, country
      from users where email = ${email}
    ` as never,
  );

  expect(row!.is_adult).toBe(true);
  // A placeholder from the address, and marked as one.
  expect(row!.confirmed).toBeNull();
  expect(row!.name.length).toBeGreaterThan(0);
  // Inferred from the browser rather than asked for.
  expect(row!.timezone).toBe('UTC');
});

test('under 18 is recorded, and the guardian is asked for at the first booking', async ({ page }) => {
  const email = newEmail('minor');

  await signOut(page);
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('radio', { name: 'No' }).check();

  // The form says what happens next rather than leaving them to wonder.
  await expect(page.getByText(/parent or guardian/)).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL((url) => url.pathname === '/');

  const [before] = await queryDatabase<{ is_adult: boolean; guardian: string | null }[]>(
    (sql) => sql`select is_adult, guardian_email as guardian from users where email = ${email}` as never,
  );
  expect(before!.is_adult).toBe(false);
  // Nothing captured yet: a 15-year-old browsing has nothing to consent to.
  expect(before!.guardian).toBeNull();

  // Give them credits and take them to a booking.
  const tutorId = await queryDatabase<{ id: string }[]>(
    (sql) => sql`
      select user_id::text as id from tutor_profiles where status = 'verified' limit 1
    ` as never,
  ).then((rows) => rows[0]!.id);

  await queryDatabase(
    (sql) => sql`
      update student_wallets set credits_cents = 50000
      where user_id = (select id from users where email = ${email})
    ` as never,
  );

  await page.goto(`/tutors/${tutorId}?mode=60`);
  await page.getByTestId('calendar-slot').first().click();
  await page.waitForURL(/\/book\?/);

  // Both deferred questions, at the moment each one matters.
  await expect(page.getByTestId('guardian-email')).toBeVisible();
  await expect(page.getByLabel('What should we call you?')).toBeVisible();

  await page.getByLabel('What should we call you?').fill('Zainab Q');
  await page.getByTestId('guardian-email').fill('a.parent@example.test');
  await page.getByTestId('confirm-booking').click();
  await page.waitForURL(/\/dashboard\?booked=/);

  const [after] = await queryDatabase<
    { guardian: string; linked: string | null; name: string; confirmed: string | null }[]
  >(
    (sql) => sql`
      select guardian_email as guardian, guardian_linked_at::text as linked,
             name, name_confirmed_at::text as confirmed
      from users where email = ${email}
    ` as never,
  );

  expect(after!.guardian).toBe('a.parent@example.test');
  expect(after!.linked).not.toBeNull();
  expect(after!.name).toBe('Zainab Q');
  expect(after!.confirmed).not.toBeNull();
});

test('the class prompt is dismissible, and comes back rather than never', async ({ page }) => {
  const email = newEmail('prompt');

  await signOut(page);
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('radio', { name: 'Yes' }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL((url) => url.pathname === '/');

  // Inline in the feed, which already works. Not a wall.
  await expect(page.getByTestId('curriculum-prompt')).toBeVisible();
  await expect(page.getByTestId('tutor-card').first()).toBeVisible();

  await page.getByTestId('dismiss-curriculum-prompt').click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByTestId('curriculum-prompt')).toHaveCount(0);
  // And the feed is untouched by dismissing it.
  await expect(page.getByTestId('tutor-card').first()).toBeVisible();

  // Not for ever: the cookie carries an expiry rather than a permanent flag.
  const cookie = (await page.context().cookies()).find(
    (entry) => entry.name === 'tutorly_class_prompt',
  );
  expect(cookie).toBeDefined();
  const days = (cookie!.expires * 1000 - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(1);
  expect(days).toBeLessThan(30);
});

test('a phone number is asked for as reminders, and is never required', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await page.goto('/dashboard');

  const reminders = page.getByTestId('reminder-preference');
  await expect(reminders).toBeVisible();
  // Framed as a thing they get, not a field they owe.
  await expect(reminders).toContainText('WhatsApp reminders');
  await expect(reminders).toContainText('Optional');
  await expect(reminders.locator('input[name="phone"]')).not.toHaveAttribute('required', '');

  await reminders.locator('input[name="phone"]').fill('+92 300 1112223');
  await reminders.getByRole('button').click();
  await page.waitForURL(/reminders=1/);

  const [row] = await queryDatabase<{ phone: string }[]>(
    (sql) => sql`select phone from users where email = ${ACCOUNTS.student}` as never,
  );
  expect(row!.phone).toBe('+92 300 1112223');

  // And it can be taken back out again.
  await reminders.locator('input[name="phone"]').fill('');
  await reminders.getByRole('button').click();
  await page.waitForURL(/reminders=1/);

  const [cleared] = await queryDatabase<{ phone: string | null }[]>(
    (sql) => sql`select phone from users where email = ${ACCOUNTS.student}` as never,
  );
  expect(cleared!.phone).toBeNull();
});
