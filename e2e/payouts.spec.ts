import { expect, test } from '@playwright/test';

import { ACCOUNTS, queryDatabase, signIn, signOut } from './helpers';

/**
 * The whole payout loop, end to end (SPEC.md §2, §16).
 *
 * `payout.ready@tutorly.test` is seeded with exactly $100.00 available and
 * `payout.short@tutorly.test` with $99.50, because the interesting part of a
 * threshold is the fifty cents either side of it.
 */

const READY = 'payout.ready@tutorly.test';
const SHORT = 'payout.short@tutorly.test';

test('the boundary: $99.50 cannot request, $100.00 can', async ({ page }) => {
  await signIn(page, SHORT);
  await page.goto('/tutor/earnings');

  await expect(page.getByTestId('earnings-available')).toHaveText('$99.50');
  await expect(page.getByTestId('payout-blocked')).toContainText('$100.00');
  await expect(page.getByTestId('request-payout')).toHaveCount(0);
});

test('a tutor requests, an admin pays it, and the reference reaches the tutor', async ({ page }) => {
  await signIn(page, READY);
  await page.goto('/tutor/earnings');

  // Seeded with a mobile wallet, because for a lot of tutors here that is the
  // only account they have.
  await expect(page.getByTestId('payout-method-on-file')).toContainText('Easypaisa');
  await expect(page.getByTestId('earnings-available')).toHaveText('$100.00');

  await page.getByTestId('request-payout').click();
  await page.waitForURL(/requested/);

  // The money leaves available the instant it is requested, so it cannot be
  // spent or requested twice while an admin looks at it.
  await expect(page.getByTestId('earnings-available')).toHaveText('$0.00');
  await expect(page.getByTestId('earnings-locked')).toHaveText('$100.00');
  await expect(page.getByTestId('open-payout')).toContainText('$100.00');

  await signOut(page);
  await signIn(page, ACCOUNTS.admin);
  await page.goto('/admin/payouts');

  const request = page
    .getByTestId('payout-request')
    .filter({ hasText: 'Easypaisa' })
    .first();
  await expect(request).toBeVisible();

  // Nothing on this screen shows an account number — only the last four.
  await expect(request).toContainText('····4567');
  await expect(request).not.toContainText('03001234567');

  // The order is fixed by the state machine, and the queue only ever offers the
  // step that is actually legal next.
  await request.getByTestId('approve-payout').click();
  await page.waitForURL((url) => url.searchParams.get('done') === 'approved');

  const approved = page.getByTestId('payout-request').filter({ hasText: 'Easypaisa' }).first();
  await expect(approved.getByTestId('pay-payout')).toHaveCount(0);
  await approved.getByTestId('send-payout').click();
  await page.waitForURL((url) => url.searchParams.get('done') === 'processing');

  const sent = page.getByTestId('payout-request').filter({ hasText: 'Easypaisa' }).first();
  await sent.getByLabel('Bank reference').fill('EP-20260905-0042');
  await sent.getByTestId('pay-payout').click();
  await page.waitForURL((url) => url.searchParams.get('done') === 'paid');

  await expect(page.getByTestId('payout-decided-row').first()).toContainText('EP-20260905-0042');

  await signOut(page);
  await signIn(page, READY);
  await page.goto('/tutor/earnings');

  await expect(page.getByTestId('payout-reference')).toContainText('EP-20260905-0042');
  await expect(page.getByTestId('earnings-locked')).toHaveText('$0.00');
});

test('every payout decision leaves an audit row', async () => {
  const rows = await queryDatabase(
    (sql) => sql`select action, reason from admin_audit where target_type = 'payout' order by created_at`,
  );

  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(rows.map((row) => row.action)).toContain('payout.approve');
  expect(rows.map((row) => row.action)).toContain('payout.paid');
});

test('the ledger still reconciles after money has left', async () => {
  const [drift] = await queryDatabase(
    (sql) => sql`
      select count(*)::int as bad
      from tutor_profiles t
      where t.payout_locked_cents <> coalesce((
        select sum(delta_cents) from ledger_entries
        where account = 'payout_locked' and owner_id = t.user_id
      ), 0)
    `,
  );

  expect(drift!.bad).toBe(0);
});

test('a tutor sees each session at the rate it was booked at', async ({ page }) => {
  await signIn(page, ACCOUNTS.verifiedTutor);
  await page.goto('/tutor/earnings');

  const rows = page.getByTestId('earning-row');
  const count = await rows.count();
  test.skip(count === 0, 'this seeded tutor has no settled sessions');

  // Whatever rates are present, each row carries its own — the page never
  // recomputes history at today's rate.
  const rates = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const rate = await row.getAttribute('data-rate');
    expect(rate).toBeTruthy();
    rates.add(rate!);
    await expect(row).toContainText(`${Math.round(Number(rate) / 100)}%`);

    // A booking that has not settled shows what to expect, marked as such,
    // rather than the ledger's honest but misleading $0.00.
    if ((await row.getAttribute('data-settled')) === 'no') {
      await expect(row).toContainText('expected');
      await expect(row).not.toContainText('$0.00');
    }
  }

  // This seeded tutor spans the repricing, so all four rates are on one page.
  expect(rates.size).toBeGreaterThan(1);
});
