/**
 * Phase 6 Part B: the paywall, moved.
 *
 * It used to be the first thing a visitor met — buy credits, then find a tutor
 * — which asks somebody to pay before they have been shown anything worth
 * paying for. It now sits at the end of the flow: browse, open a profile, pick
 * a time, *then* see the price and top up.
 *
 * The hard part is not moving it. It is that a signed-out visitor who picks a
 * time and goes off to create an account has to come back to **that time**,
 * still held. Otherwise "sign up to book this" means "sign up and find out".
 */

import { expect, test, type Page } from '@playwright/test';

import { ACCOUNTS, createStudent, queryDatabase, SEED_PASSWORD, signIn, signOut } from './helpers';

test.describe.configure({ mode: 'serial' });

function newEmail(prefix: string): string {
  return `${prefix}.${Date.now().toString(36)}@example.test`;
}

/**
 * A tutor whose calendar actually has a free slot right now.
 *
 * Not just "has availability rules": by the time this file runs, earlier specs
 * have booked and held slots, and a tutor with a full fortnight is a confusing
 * failure rather than a useful one. So ask the page, which is the same thing a
 * student would do.
 */
async function tutorWithAFreeSlot(page: Page): Promise<string> {
  const candidates = await queryDatabase<{ id: string }[]>(
    (sql) => sql`
      select tp.user_id::text as id
      from tutor_profiles tp
      join availability_rules r on r.tutor_id = tp.user_id and r.active
      where tp.status = 'verified'
      group by tp.user_id
      limit 12
    ` as never,
  );

  for (const candidate of candidates) {
    await page.goto(`/tutors/${candidate.id}?mode=60`);
    if ((await page.getByTestId('calendar-slot').count()) > 0) return candidate.id;
  }

  throw new Error('no verified tutor has a free slot — run `pnpm e2e`, which reseeds first');
}

test('the whole browse-to-slot flow works signed out', async ({ page }) => {
  await signOut(page);

  await page.goto('/');
  await page.getByTestId('tutor-card').first().getByRole('link').first().click();
  await page.waitForURL(/\/tutors\//);

  // A price and a calendar, with no account and no credits.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const slots = page.getByTestId('calendar-slot');
  await expect(slots.first()).toBeVisible();

  // And the slots are pressable, not decoration behind a sign-in wall.
  await expect(slots.first()).toBeEnabled();
});

test('a signed-out visitor picks a slot, signs up, and lands back on it still held', async ({
  page,
}) => {
  const email = newEmail('paywall');

  await signOut(page);
  const tutorId = await tutorWithAFreeSlot(page);

  const slot = page.getByTestId('calendar-slot').first();
  await expect(slot).toBeVisible();
  const startUtc = (await slot.getAttribute('data-start'))!;
  await slot.click();

  // Sent to sign up, told the slot is being kept.
  await page.waitForURL(/\/signup\?/);
  await expect(page.getByTestId('held-notice')).toBeVisible();

  // The hold exists already, under a guest token — before the account does.
  const [guestHold] = await queryDatabase<{ total: number }[]>(
    (sql) => sql`
      select count(*)::int as total from slot_holds
      where tutor_id = ${tutorId}::uuid
        and start_at_utc = ${startUtc}::timestamptz
        and guest_token is not null
        and student_id is null
        and expires_at > now()
    ` as never,
  );
  expect(guestHold!.total).toBe(1);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('radio', { name: 'Yes' }).check();
  await page.getByRole('button', { name: 'Create account' }).click();

  // Back on the same lesson — not the home page, not a dashboard.
  await page.waitForURL(/\/book\?/);
  expect(page.url()).toContain(encodeURIComponent(startUtc));
  await expect(page.getByTestId('hold-notice')).toBeVisible();

  // And the hold is theirs now, not a guest's.
  const [claimed] = await queryDatabase<{ total: number }[]>(
    (sql) => sql`
      select count(*)::int as total from slot_holds h
      join users u on u.id = h.student_id
      where u.email = ${email}
        and h.tutor_id = ${tutorId}::uuid
        and h.start_at_utc = ${startUtc}::timestamptz
        and h.guest_token is null
        and h.expires_at > now()
    ` as never,
  );
  expect(claimed!.total).toBe(1);
});

test('the top-up is inline, and the hold survives the round trip through it', async ({ page }) => {
  const email = newEmail('topup');

  await signOut(page);
  const tutorId = await tutorWithAFreeSlot(page);
  const slot = page.getByTestId('calendar-slot').first();
  const startUtc = (await slot.getAttribute('data-start'))!;
  await slot.click();

  await page.waitForURL(/\/signup\?/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('radio', { name: 'Yes' }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/book\?/);

  // A brand new account has nothing, so the shortfall is on this page rather
  // than behind a redirect to a credits screen.
  await expect(page.getByTestId('inline-top-up')).toBeVisible();
  await expect(page.getByTestId('confirm-booking')).toBeDisabled();

  const expiresBefore = await queryDatabase<{ expires: string }[]>(
    (sql) => sql`
      select h.expires_at::text as expires from slot_holds h join users u on u.id = h.student_id
      where u.email = ${email} and h.start_at_utc = ${startUtc}::timestamptz
    ` as never,
  ).then((rows) => rows[0]!.expires);

  // Buy enough, through the checkout, and come straight back here.
  await page.getByTestId('buy-pro').click();
  await page.waitForURL(/\/credits\/checkout\//);
  await page.getByTestId('pay-now').click();
  await page.waitForURL(/\/book\?/);

  // Still the same slot, still held, and now affordable.
  expect(page.url()).toContain(encodeURIComponent(startUtc));
  await expect(page.getByTestId('inline-top-up')).toHaveCount(0);
  await expect(page.getByTestId('hold-notice')).toBeVisible();

  const [stillHeld] = await queryDatabase<{ total: number; expires: string }[]>(
    (sql) => sql`
      select count(*)::int as total, max(h.expires_at)::text as expires
      from slot_holds h join users u on u.id = h.student_id
      where u.email = ${email}
        and h.tutor_id = ${tutorId}::uuid
        and h.start_at_utc = ${startUtc}::timestamptz
        and h.expires_at > now()
    ` as never,
  );
  expect(stillHeld!.total).toBe(1);
  expect(stillHeld!.expires).toBe(expiresBefore);

  // And the commit works, from the same page, with no further detours.
  await page.getByLabel('What should we call you?').fill('Paywall Tester');
  await page.getByTestId('confirm-booking').click();
  await page.waitForURL(/\/dashboard\?booked=/);

  const bookingId = page.url().split('booked=')[1]!;
  const [booking] = await queryDatabase<{ status: string; escrow: number; price: number }[]>(
    (sql) => sql`
      select b.status, b.price_cents::int as price,
             (select coalesce(sum(delta_cents), 0)::int from ledger_entries
               where booking_id = b.id and account = 'escrow') as escrow
      from bookings b where b.id = ${bookingId}::uuid
    ` as never,
  );

  expect(booking!.status).toBe('confirmed');
  expect(booking!.escrow).toBe(booking!.price);

  // The hold is gone: it became a booking.
  const [heldAfter] = await queryDatabase<{ total: number }[]>(
    (sql) => sql`
      select count(*)::int as total from slot_holds h join users u on u.id = h.student_id
      where u.email = ${email} and h.start_at_utc = ${startUtc}::timestamptz and h.expires_at > now()
    ` as never,
  );
  expect(heldAfter!.total).toBe(0);
});

test('the $5 pack is a taste, not a tier', async ({ page }) => {
  // Made directly: this test is about the pack, not about the signup form, and
  // the form is rate limited to five registrations a minute per IP.
  const email = newEmail('taste');
  await createStudent(email);
  await signIn(page, email);

  await page.goto('/credits');
  await expect(page.locator('[data-testid="credit-pack"][data-pack="taste"]')).toBeVisible();

  await page.getByTestId('buy-taste').click();
  await page.waitForURL(/\/credits\/checkout\//);
  await page.getByTestId('pay-now').click();
  await page.waitForURL(/credited=1/);

  // Gone from the shelf once it has been used.
  await page.goto('/credits');
  await expect(page.locator('[data-testid="credit-pack"][data-pack="taste"]')).toHaveCount(0);

  // And refused even when asked for directly, because a hidden button is not a
  // rule. The database index is.
  const purchases = await queryDatabase<{ total: number }[]>(
    (sql) => sql`
      select count(*)::int as total from credit_purchases p join users u on u.id = p.user_id
      where u.email = ${email} and p.first_purchase_only and p.status <> 'failed'
    ` as never,
  );
  expect(purchases[0]!.total).toBe(1);

  const refused = await queryDatabase(async (sql) => {
    const [user] = await sql`select id from users where email = ${email}`;
    try {
      await sql`
        insert into credit_purchases
          (user_id, pack_id, paid_cents, credits_cents, provider, status, idempotency_key, first_purchase_only)
        values (${user!.id}, 'taste', 500, 500, 'mock', 'pending', ${'k' + Date.now()}, true)
      `;
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  });
  // 23505: unique violation on one-first-purchase-per-person.
  expect(refused).toBe('23505');
});

test('a Pakistani student is offered a wallet first, and everyone still sees everything', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.student);

  await queryDatabase(
    (sql) => sql`update users set country = 'PK' where email = ${ACCOUNTS.student}` as never,
  );
  await page.goto('/credits');

  const methods = await page
    .getByTestId('payment-method')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-method')));

  expect(methods.slice(0, 2).sort()).toEqual(['easypaisa', 'jazzcash']);
  // Nothing is removed: a Pakistani student with a card can still use it.
  expect(methods).toContain('mock');

  // Somewhere else, the card leads — and the wallets are still on the list.
  await queryDatabase(
    (sql) => sql`update users set country = 'GB' where email = ${ACCOUNTS.student}` as never,
  );
  await page.reload();

  const uk = await page
    .getByTestId('payment-method')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-method')));
  expect(uk[0]).toBe('mock');
  expect(uk).toContain('jazzcash');
});

test('a purchase through a wallet goes through that wallet, end to end', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await queryDatabase(
    (sql) => sql`update users set country = 'PK' where email = ${ACCOUNTS.student}` as never,
  );

  const before = await queryDatabase<{ credits: number }[]>(
    (sql) => sql`
      select w.credits_cents::int as credits from student_wallets w
      join users u on u.id = w.user_id where u.email = ${ACCOUNTS.student}
    ` as never,
  ).then((rows) => rows[0]!.credits);

  await page.goto('/credits');
  await page.locator('[data-testid="payment-method"][data-method="easypaisa"] input').check();
  await page.getByTestId('buy-starter').click();

  await page.waitForURL(/\/credits\/checkout\//);
  await expect(page.getByText('Easypaisa').first()).toBeVisible();
  await page.getByTestId('pay-now').click();
  await page.waitForURL(/credited=1/);

  const [purchase] = await queryDatabase<{ provider: string; status: string }[]>(
    (sql) => sql`
      select p.provider, p.status from credit_purchases p join users u on u.id = p.user_id
      where u.email = ${ACCOUNTS.student} order by p.created_at desc limit 1
    ` as never,
  );

  // The row records which provider it went through, and the money arrived.
  expect(purchase!.provider).toBe('easypaisa');
  expect(purchase!.status).toBe('paid');

  const after = await queryDatabase<{ credits: number }[]>(
    (sql) => sql`
      select w.credits_cents::int as credits from student_wallets w
      join users u on u.id = w.user_id where u.email = ${ACCOUNTS.student}
    ` as never,
  ).then((rows) => rows[0]!.credits);
  expect(after).toBe(before + 1_000);
});

test('a tutor is shown what they take home, not just what they charge', async ({ page }) => {
  await signIn(page, ACCOUNTS.verifiedTutor);
  await page.goto('/tutor');

  const takeHome = page.getByTestId('take-home');
  await expect(takeHome).toBeVisible();
  await expect(takeHome).toContainText('You’ll receive');
  // Both numbers, because a rate is one figure and income is two.
  await expect(takeHome).toContainText('once they come back');

  const [profile] = await queryDatabase<{ hourly: number }[]>(
    (sql) => sql`
      select tp.hourly_cents::int as hourly from tutor_profiles tp join users u on u.id = tp.user_id
      where u.email = ${ACCOUNTS.verifiedTutor}
    ` as never,
  );

  const expected = profile!.hourly - Math.floor((profile!.hourly * 2_200) / 10_000);
  await expect(takeHome).toContainText(`$${(expected / 100).toFixed(2)}`);
});
