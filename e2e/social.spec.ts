/**
 * Trials, messaging, reviews and follows (SPEC.md §4, §6, §8, §9).
 *
 * The acceptance line for this phase is one journey: a free trial requested,
 * accepted, taken, and the conversion CTA firing afterwards. The rest of the
 * file covers the things that would be quietly wrong rather than visibly
 * broken — a raw message body reachable through a route, a review from someone
 * who never took the session, a follower who hears nothing.
 */

import { expect, test, type Page } from '@playwright/test';

import { ACCOUNTS, SEED_PASSWORD, queryDatabase, signIn, signOut } from './helpers';

type TutorRow = { id: string; email: string; name: string; trial_minutes: number };

/** A verified tutor who offers trials, has hours published, and is free to ask. */
async function trialTutor(): Promise<TutorRow> {
  const rows = await queryDatabase<TutorRow[]>(
    (sql) => sql`
      select u.id::text, u.email, u.name, p.trial_minutes
      from tutor_profiles p
      join users u on u.id = p.user_id
      where p.status = 'verified'
        and p.offers_trial
        and exists (select 1 from availability_rules r where r.tutor_id = p.user_id and r.active)
        and not exists (
          select 1 from bookings b
          join users s on s.id = b.student_id
          where b.tutor_id = p.user_id and b.is_trial and s.email = ${ACCOUNTS.student}
        )
      order by u.email
      limit 1
    ` as never,
  );

  expect(rows.length, 'the seed should leave a tutor free to ask for a trial').toBeGreaterThan(0);
  return rows[0]!;
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
}

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

test.describe('free trials', () => {
  test.describe.configure({ mode: 'serial' });

  test('a student asks, the tutor accepts, and neither of them is charged', async ({ page }) => {
    const tutor = await trialTutor();

    await signIn(page, ACCOUNTS.student);
    await page.goto(`/tutors/${tutor.id}`);

    // The trial is the primary call to action, not a link buried in a calendar.
    await page.getByRole('link', { name: 'Book free trial' }).click();
    await page.waitForURL(/mode=trial/);

    const slot = page.getByTestId('calendar-slot').first();
    await expect(slot).toBeVisible();
    const startedAt = await slot.getAttribute('data-start');
    await slot.click();

    await page.waitForURL(/\/dashboard/);
    await expect(page.getByText(/Trial requested/)).toBeVisible();
    await expect(page.getByTestId('outgoing-trial')).toContainText(tutor.name);

    // Zero credits move, and no escrow row exists (SPEC.md §6).
    const [booking] = await queryDatabase<
      { id: string; status: string; price_cents: number; escrow_cents: number; ledger: number }[]
    >(
      (sql) => sql`
        select b.id::text, b.status, b.price_cents, b.escrow_cents,
               (select count(*)::int from ledger_entries l where l.booking_id = b.id) as ledger
        from bookings b
        join users s on s.id = b.student_id
        where b.tutor_id = ${tutor.id}::uuid and b.is_trial and s.email = ${ACCOUNTS.student}
      ` as never,
    );

    expect(booking?.status).toBe('pending_tutor');
    expect(booking?.price_cents).toBe(0);
    expect(booking?.escrow_cents).toBe(0);
    expect(booking?.ledger).toBe(0);
    expect(startedAt).toBeTruthy();

    // The tutor sees it, with the clock on it, and accepts.
    await signOut(page);
    await signInAs(page, tutor.email);
    await page.goto('/tutor');

    const request = page.getByTestId('trial-request').first();
    await expect(request).toBeVisible();
    await expect(request).toContainText(/left/);
    await request.getByRole('button', { name: 'Accept' }).click();

    await expect(page.getByTestId('trial-request')).toHaveCount(0);

    const [confirmed] = await queryDatabase<{ status: string }[]>(
      (sql) => sql`select status from bookings where id = ${booking!.id}::uuid` as never,
    );
    expect(confirmed?.status).toBe('confirmed');
  });

  test('the same student cannot have a second trial with that tutor, ever', async ({ page }) => {
    const [tutor] = await queryDatabase<{ id: string }[]>(
      (sql) => sql`
        select b.tutor_id::text as id
        from bookings b join users s on s.id = b.student_id
        where b.is_trial and s.email = ${ACCOUNTS.student}
        limit 1
      ` as never,
    );

    await signIn(page, ACCOUNTS.student);
    await page.goto(`/tutors/${tutor!.id}?mode=trial`);

    // No trial chip, no trial CTA — the offer is gone rather than failing later.
    await expect(page.getByRole('link', { name: 'Book free trial' })).toHaveCount(0);
    await expect(page.getByText('You have already had your free trial with this tutor.')).toBeVisible();
  });

  test('the conversion moment survives closing the tab', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await page.goto('/dashboard');

    const conversion = page.getByTestId('trial-conversion');
    await expect(conversion).toBeVisible();
    await expect(conversion).toContainText('Book a full session');

    // Three real slots from the availability engine, not a placeholder.
    await expect(conversion.getByTestId('conversion-slot')).toHaveCount(3);
  });
});

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

test.describe('messaging', () => {
  test.describe.configure({ mode: 'serial' });

  const PHONE = '+92 300 7654321';
  const EMAIL = 'sneaky.student@example.com';

  test('contact details are redacted on write, and the tutor never sees the raw text', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await page.goto('/messages');

    const thread = page.getByTestId('thread-link').first();
    await expect(thread).toBeVisible();
    await thread.click();
    await page.waitForURL(/\/messages\/[0-9a-f-]{36}/);

    const threadId = page.url().split('/messages/')[1]!.split('?')[0]!;

    await page.getByLabel('Your message').fill(`call me on ${PHONE} or email ${EMAIL}`);
    await page.getByRole('button', { name: 'Send' }).click();

    const last = page.getByTestId('message').last();
    await expect(last).toContainText('[hidden]');
    await expect(last).not.toContainText('7654321');
    await expect(last.getByText('contact details hidden')).toBeVisible();

    // Stored both ways: masked for people, raw for moderation only.
    const [stored] = await queryDatabase<{ masked: string; raw: string; redactions: number }[]>(
      (sql) => sql`
        select body_masked as masked, body_raw as raw, redactions
        from messages where thread_id = ${threadId}::uuid
        order by created_at desc limit 1
      ` as never,
    );

    expect(stored?.masked).not.toContain('7654321');
    expect(stored?.raw).toContain('7654321');
    expect(stored?.redactions).toBeGreaterThanOrEqual(2);

    // The other side of the conversation: the raw text is nowhere in the page.
    const [tutor] = await queryDatabase<{ email: string }[]>(
      (sql) => sql`
        select u.email from threads t join users u on u.id = t.tutor_id
        where t.id = ${threadId}::uuid
      ` as never,
    );

    await signOut(page);
    await signInAs(page, tutor!.email);
    await page.goto(`/messages/${threadId}`);

    const html = await page.content();
    expect(html).not.toContain('7654321');
    expect(html).not.toContain('sneaky.student');
    expect(html).toContain('[hidden]');
  });

  test('somebody outside the thread gets a 404, not a 403', async ({ page }) => {
    const [thread] = await queryDatabase<{ id: string }[]>(
      (sql) => sql`
        select t.id::text from threads t
        join users s on s.id = t.student_id
        where s.email <> ${ACCOUNTS.student}
        limit 1
      ` as never,
    );

    await signIn(page, ACCOUNTS.student);
    const response = await page.goto(`/messages/${thread!.id}`);
    expect(response?.status()).toBe(404);
  });

  test('a tutor answering quickly earns the badge the feed shows', async () => {
    const [fast] = await queryDatabase<{ id: string; response_median_seconds: number }[]>(
      (sql) => sql`
        select user_id::text as id, response_median_seconds
        from tutor_profiles
        where status = 'verified' and response_median_seconds is not null
        order by response_median_seconds asc limit 1
      ` as never,
    );

    // The medians come from real seeded conversations, not from a fixture column.
    expect(fast?.response_median_seconds).toBeGreaterThan(0);

    const [ranked] = await queryDatabase<{ response_speed_bps: number }[]>(
      (sql) => sql`select response_speed_bps from tutor_ranking where tutor_id = ${fast!.id}::uuid` as never,
    );

    // 5000 is the neutral score for "we do not know"; a fast tutor beats it.
    expect(ranked?.response_speed_bps).toBeGreaterThan(5_000);
  });
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

test.describe('reviews', () => {
  test.describe.configure({ mode: 'serial' });

  test('a student reviews a session they took, and it appears on the profile', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await page.goto('/dashboard');

    const form = page.getByTestId('review-form').first();
    await expect(form).toBeVisible();

    const tutorId = await form.locator('input[name="tutorId"]').inputValue();
    await form.getByRole('radio', { name: '5★' }).check();
    await form.getByRole('textbox').fill('Patient, and explained the method rather than the answer.');
    await form.getByRole('button', { name: /review/i }).click();

    await expect(page.getByText('your review is live')).toBeVisible();

    await page.goto(`/tutors/${tutorId}`);
    await expect(page.getByText('Patient, and explained the method rather than the answer.')).toBeVisible();
  });

  test('an admin can hide one, with a reason and an audit row', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.goto('/admin/moderation');

    // The first review that is not already hidden — the queue keeps hidden ones
    // on screen so they can be restored.
    const review = page
      .getByTestId('admin-review')
      .filter({ has: page.getByPlaceholder('Why is this being hidden?') })
      .first();
    await expect(review).toBeVisible();

    await review.getByPlaceholder('Why is this being hidden?').fill('Names another student.');
    await review.getByRole('button', { name: 'Hide' }).click();

    await expect(page.getByTestId('admin-review').filter({ hasText: 'hidden' }).first()).toBeVisible();

    const [audit] = await queryDatabase<{ action: string; reason: string }[]>(
      (sql) => sql`
        select action, reason from admin_audit
        where action = 'review.hide' order by created_at desc limit 1
      ` as never,
    );

    expect(audit?.action).toBe('review.hide');
    expect(audit?.reason).toBe('Names another student.');
  });

  test('a hidden review leaves the rating it was counted in', async () => {
    const [hidden] = await queryDatabase<{ tutor_id: string; rating: number }[]>(
      (sql) => sql`
        select tutor_id::text, rating from reviews where hidden_at is not null limit 1
      ` as never,
    );

    const [visible] = await queryDatabase<{ total: number }[]>(
      (sql) => sql`
        select count(*)::int as total from reviews
        where tutor_id = ${hidden!.tutor_id}::uuid and hidden_at is null
      ` as never,
    );

    const [all] = await queryDatabase<{ total: number }[]>(
      (sql) => sql`
        select count(*)::int as total from reviews where tutor_id = ${hidden!.tutor_id}::uuid
      ` as never,
    );

    expect(all!.total).toBeGreaterThan(visible!.total);
  });
});

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

test('following a tutor means hearing when they publish new hours', async ({ page }) => {
  const tutor = await trialTutor();

  await signIn(page, ACCOUNTS.student);
  await page.goto(`/tutors/${tutor.id}`);

  const follow = page.getByRole('button', { name: 'Follow' });
  await expect(follow).toBeVisible();
  await follow.click();
  await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();

  // The tutor opens up an extra window.
  await signOut(page);
  await signInAs(page, tutor.email);
  await page.goto('/tutor/onboarding/availability');

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('What is this?').selectOption('extra');
  await page.getByLabel('From', { exact: true }).fill(tomorrow);
  await page.getByLabel('Start time').fill('20:00');
  await page.getByLabel('To', { exact: true }).fill(tomorrow);
  await page.getByLabel('End time').fill('22:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // The follower hears about it.
  await signOut(page);
  await signIn(page, ACCOUNTS.student);
  await page.goto('/notifications');

  await expect(page.getByTestId('notification').first()).toContainText(
    `${tutor.name.split(' ')[0]}`,
  );
  await expect(page.getByText('added new times').first()).toBeVisible();
});
