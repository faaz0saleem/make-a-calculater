/**
 * The product on a 360px phone.
 *
 * Most of this market browses on a phone, so a layout that only works on a
 * laptop is a layout that does not work. These tests are deliberately blunt:
 * nothing may push the page sideways, the things you press must be big enough
 * to press, and every control must be reachable from the keyboard with the
 * focus ring actually visible.
 */

import { expect, test, type Page } from '@playwright/test';

import { ACCOUNTS, PHONE_WIDTH, expectNoSidewaysScroll, queryDatabase, signIn } from './helpers';

test.use({ viewport: { width: PHONE_WIDTH, height: 740 } });

async function liveBookingId(): Promise<string> {
  const rows = await queryDatabase<{ id: string }[]>(
    (sql) => sql`
      select b.id from bookings b
      join users s on s.id = b.student_id
      where s.email = ${ACCOUNTS.student}
        and b.status in ('confirmed', 'in_progress')
        and b.start_at_utc <= now()
        and b.start_at_utc + make_interval(mins => b.duration_minutes) > now()
      limit 1
    ` as never,
  );
  expect(
    rows,
    'the seed should leave one session running right now — run `pnpm e2e`, which reseeds first',
  ).toHaveLength(1);
  return rows[0]!.id;
}

test('the signed-out pages fit a 360px screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find a tutor worth your hour' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'the feed');

  const firstTutor = page.getByTestId('tutor-card').first();
  await expect(firstTutor).toBeVisible();
  await firstTutor.getByRole('link').first().click();
  await page.waitForURL(/\/tutors\//);
  await expectNoSidewaysScroll(page, 'a tutor profile');

  await page.goto('/signup');
  await expectNoSidewaysScroll(page, 'sign up');
});

test('the signed-in pages fit a 360px screen', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /^Hello/ })).toBeVisible();
  await expectNoSidewaysScroll(page, 'the student dashboard');

  await page.goto(`/sessions/${await liveBookingId()}`);
  await expect(page.getByRole('heading', { name: 'Check your setup' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'the classroom');

  await page.goto('/messages');
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'the conversation list');

  const thread = page.getByTestId('thread-link').first();
  if (await thread.isVisible().catch(() => false)) {
    await thread.click();
    await page.waitForURL(/\/messages\/[0-9a-f-]{36}/);
    await expectNoSidewaysScroll(page, 'a conversation');
  }

  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'notifications');

  await page.goto('/settings/curriculum');
  await expect(page.getByRole('heading', { name: 'My classes' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'the curriculum settings page');

  await page.goto('/credits');
  await expect(page.getByRole('heading', { name: 'Buy credits' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'the credits page');

  await page.getByTestId('buy-starter').click();
  await page.waitForURL(/\/credits\/checkout\//);
  await expectNoSidewaysScroll(page, 'the checkout page');
});

test('the tutor pages fit a 360px screen', async ({ page }) => {
  await signIn(page, ACCOUNTS.verifiedTutor);
  await page.goto('/tutor');
  await expect(page.getByRole('heading', { name: 'Teaching' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'the tutor home');

  // Three selects per row, fifteen rows deep — the easiest layout in the
  // product to push sideways on a phone.
  await page.goto('/tutor/onboarding/subjects');
  await expect(page.getByRole('heading', { name: 'Boards and classes' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'the boards and classes step');
});

test('the admin curriculum screen fits a 360px screen', async ({ page }) => {
  await signIn(page, ACCOUNTS.admin);
  await page.goto('/admin/curriculum');
  await expect(page.getByRole('heading', { name: 'Boards and classes' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'the admin curriculum screen');
});

test('what you press before a lesson is big enough to press with a thumb', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await page.goto(`/sessions/${await liveBookingId()}`);

  const start = page.getByRole('button', { name: 'Run the check' });
  const box = await start.boundingBox();
  expect(box, 'the pre-call button should be laid out').toBeTruthy();
  // The WCAG 2.2 target-size minimum, which is roughly a fingertip.
  expect(box!.height).toBeGreaterThanOrEqual(40);
});

test('the classroom is reachable from the keyboard, with a visible focus ring', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await page.goto(`/sessions/${await liveBookingId()}`);

  const start = page.getByRole('button', { name: 'Run the check' });
  await expect(start).toBeVisible();

  // Tab until we land on it, rather than clicking: this is the path somebody
  // using a keyboard or a switch device actually takes.
  for (let press = 0; press < 20; press += 1) {
    if (await start.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }

  await expect(start).toBeFocused();

  const ring = await start.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      matchesFocusVisible: element.matches(':focus-visible'),
      boxShadow: style.boxShadow,
      outline: style.outlineStyle,
    };
  });

  expect(ring.matchesFocusVisible, 'keyboard focus should count as focus-visible').toBe(true);
  expect(
    ring.boxShadow !== 'none' || ring.outline !== 'none',
    `focused button had no visible ring: ${JSON.stringify(ring)}`,
  ).toBe(true);
});
