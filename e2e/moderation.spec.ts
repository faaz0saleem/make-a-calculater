import { expect, test } from '@playwright/test';

import { ACCOUNTS, queryDatabase, signIn, signOut } from './helpers';

/**
 * Contact-info handling, the reports queue, and the graduated response
 * (SPEC.md §8, §10).
 *
 * The assertion that matters most is the negative one: a message full of
 * question numbers and page references produces nothing at all.
 */

test('the composer warns before sending, and never blocks', async ({ page }) => {
  const thread = await queryDatabase(async (sql) => {
    const [row] = await sql`
      select t.id, u.email
      from threads t
      join users u on u.id = t.student_id
      where u.password_hash is not null
      order by t.created_at
      limit 1
    `;
    return row as { id: string; email: string } | undefined;
  });

  expect(thread, 'the seed always creates conversations').toBeTruthy();

  await signIn(page, thread!.email);
  await page.goto(`/messages/${thread!.id}`);

  const box = page.getByLabel('Your message');

  // Teaching, full of digits. Nothing is said, because nothing is wrong.
  await box.fill('Do question 15 on page 240, then 18 to 22 on page 241.');
  await expect(page.getByTestId('contact-hint')).toHaveCount(0);

  await box.fill('If 2x + 3 = 11 then x = 4. Substitute u = 03 into v = u + at.');
  await expect(page.getByTestId('contact-hint')).toHaveCount(0);

  // An attempt. Warned — and the Send button stays live, which is the whole
  // point: nothing is ever blocked mid-conversation.
  await box.fill('easier on whatsapp, my number is 0300 1234567');
  await expect(page.getByTestId('contact-hint')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('a high-confidence message reaches the queue and triggers nothing', async ({ page }) => {
  const before = await queryDatabase(
    (sql) => sql`select count(*)::int as total from user_sanctions`,
  );

  await signIn(page, ACCOUNTS.admin);
  await page.goto('/admin/reports');

  const flags = page.getByTestId('contact-flag');
  await expect(flags.first()).toBeVisible();
  await expect(flags.first().getByTestId('flag-score')).toContainText('/ 100');

  // Seeded messages that are pure schoolwork are not in this queue.
  await expect(page.getByTestId('contact-flag').filter({ hasText: 'page 240' })).toHaveCount(0);

  // And nothing has happened to anybody: scoring a message issues no sanction.
  const after = await queryDatabase(
    (sql) => sql`select count(*)::int as total from user_sanctions`,
  );
  expect(after[0]!.total).toBe(before[0]!.total);
});

test('confirming a flag warns the tutor, who must acknowledge it and may appeal', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.admin);
  await page.goto('/admin/reports');

  const flag = page.getByTestId('contact-flag').first();

  await flag.locator('summary').click();
  await flag.getByLabel('What they will read, word for word.').fill(
    'You asked a student to move to WhatsApp. Everything you need is here, and lessons arranged elsewhere are not covered.',
  );
  await flag.getByTestId('sanction-warning').click();
  await page.waitForURL(/done=/);

  // Found through the flag rather than by name: the seed has enough people in
  // it that two can share one, and warning the wrong account would pass here
  // and be a very bad bug in production.
  const email = await queryDatabase(async (sql) => {
    const [row] = await sql`
      select u.email
      from contact_flags f
      join users u on u.id = f.sender_id
      where f.status = 'confirmed'
      order by f.reviewed_at desc
      limit 1
    `;
    return row?.email as string | undefined;
  });

  expect(email).toBeTruthy();

  await signOut(page);
  await signIn(page, email!);

  // Impossible to miss: the header carries it until it is read.
  await expect(page.getByTestId('notice-nudge')).toBeVisible();

  await page.goto('/settings/notices');
  await expect(page.getByTestId('notice')).toContainText('WhatsApp');

  await page.getByTestId('acknowledge-notice').click();
  await page.waitForURL(/done=read/);
  await expect(page.getByTestId('notice-nudge')).toHaveCount(0);

  // A warning changes nothing about the account.
  const [restricted] = await queryDatabase(
    (sql) => sql`
      select count(*)::int as total from user_sanctions
      where level = 'restriction' and restricted_until > now()
    `,
  );
  expect(restricted!.total).toBe(0);

  await page.getByText('Appeal this').click();
  await page.getByLabel('Tell us what we got wrong. A person reads it.').fill(
    'I was reading a phone number out of a physics question, not giving them mine.',
  );
  await page.getByTestId('send-appeal').click();
  await page.waitForURL(/done=appealed/);
});

test('a report is resolved with an action and a reason, and it is audited', async ({ page }) => {
  await signIn(page, ACCOUNTS.admin);
  await page.goto('/admin/reports');

  const report = page.getByTestId('report-row').first();
  await expect(report).toBeVisible();

  await report.getByLabel('Why. Both sides read this.').fill(
    'Checked the thread. Nothing here breaches anything — the tutor was quoting an exam question.',
  );
  await report.getByTestId('report-dismissed').click();
  await page.waitForURL(/done=/);

  const rows = await queryDatabase(
    (sql) => sql`
      select action, reason from admin_audit where target_type = 'report' order by created_at desc limit 1
    `,
  );

  expect(rows[0]?.action).toBe('report.resolve');
  expect(String(rows[0]?.reason)).toContain('exam question');
});

test('a student can report a tutor from their profile', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);

  const tutorId = await queryDatabase(async (sql) => {
    const [row] = await sql`
      select user_id from tutor_profiles where status = 'verified' order by user_id limit 1
    `;
    return row?.user_id as string;
  });

  await page.goto(`/tutors/${tutorId}`);
  await page.getByText('Report this tutor').click();
  await page.getByLabel('Asked me to pay or message off Tutorly').check();
  await page.getByTestId('send-report').click();

  await expect(page.getByTestId('reported')).toBeVisible();
});
