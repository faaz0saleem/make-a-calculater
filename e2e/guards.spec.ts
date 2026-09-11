/**
 * Phase 10: proving the guards refuse.
 *
 * Every test in this file asserts a **violation is stopped**. That is the gap
 * this file exists to close: the suite was full of tests proving the right
 * thing is allowed, and a check that runs, returns success and enforces nothing
 * looks exactly the same from that side. "Sign out everywhere" passed every
 * test it had while defending nothing.
 *
 * So: no happy paths here. Only the refusals.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  ACCOUNTS,
  SEED_PASSWORD,
  createStudent,
  queryDatabase,
  revealEveryDay,
  signIn,
  signInWith,
} from './helpers';

test.describe.configure({ mode: 'serial' });

/** Every page an admin has. A student must reach none of them. */
const ADMIN_PAGES = [
  '/admin',
  '/admin/payouts',
  '/admin/verification',
  '/admin/reports',
  '/admin/moderation',
  '/admin/curriculum',
  '/admin/packs',
  '/admin/alerts',
  '/admin/invite',
];

async function signOutHard(page: Page): Promise<void> {
  await page.context().clearCookies();
}

test('a student is refused every admin page', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);

  for (const path of ADMIN_PAGES) {
    await page.goto(path);
    expect(new URL(page.url()).pathname, `a student reached ${path}`).not.toMatch(/^\/admin/);
  }
});

test('an admin reaches every admin page', async ({ page }) => {
  // The other half, so a wall that refuses everybody does not read as a pass.
  await signOutHard(page);
  await signIn(page, ACCOUNTS.admin);

  for (const path of ADMIN_PAGES) {
    await page.goto(path);
    expect(new URL(page.url()).pathname, `an admin was bounced off ${path}`).toMatch(/^\/admin/);
  }
});

test('demoting an admin takes effect on the session they are already holding', async ({ page }) => {
  // The JWT carries a copy of the roles and is believed for thirty days. Until
  // this was fixed, `requireRole` read that copy, so taking the role away did
  // nothing until the token expired.
  await signOutHard(page);
  await signIn(page, ACCOUNTS.admin);
  await page.goto('/admin/payouts');
  await expect(page.getByRole('heading', { name: 'Payout queue' })).toBeVisible();

  const roles = await queryDatabase<{ roles: string[] }[]>(
    (sql) => sql`select roles from users where email = ${ACCOUNTS.admin}` as never,
  ).then((rows) => rows[0]!.roles);

  await queryDatabase(
    (sql) => sql`update users set roles = array['student']::user_role[] where email = ${ACCOUNTS.admin}`,
  );

  try {
    await page.goto('/admin/payouts');
    expect(new URL(page.url()).pathname, 'a demoted admin kept the payout queue').not.toMatch(
      /^\/admin/,
    );
  } finally {
    await queryDatabase(
      (sql) => sql`update users set roles = ${roles}::user_role[] where email = ${ACCOUNTS.admin}`,
    );
  }
});

test('suspending an account ends the session it is already holding', async ({ page }) => {
  // Six queries in the codebase refuse a suspended user. None of them covered
  // the session they were already signed in with.
  await signOutHard(page);
  await signIn(page, ACCOUNTS.student);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/);

  await queryDatabase(
    (sql) => sql`update users set suspended_at = now() where email = ${ACCOUNTS.student}`,
  );

  try {
    await page.goto('/dashboard');
    expect(new URL(page.url()).pathname, 'a suspended account kept its session').not.toMatch(
      /^\/dashboard/,
    );
  } finally {
    await queryDatabase(
      (sql) => sql`update users set suspended_at = null where email = ${ACCOUNTS.student}`,
    );
  }
});

test('a minor cannot book, start a series or ask for a trial without a guardian', async ({ page }) => {
  // The booking form marks the field `required`, which is an attribute in
  // somebody else's browser. Until this was fixed the server accepted a blank
  // one and booked a child into a paid session with no adult on record.
  const email = `minor.guard.${Date.now().toString(36)}@example.test`;

  const studentId = await queryDatabase<{ id: string }[]>(
    (sql) => sql`
      insert into users (email, password_hash, name, roles, timezone, is_adult, email_verified_at)
      values (
        ${email},
        (select password_hash from users where email = ${ACCOUNTS.student}),
        'Minor Guard', array['student']::user_role[], 'UTC', false, now()
      )
      returning id::text as id
    ` as never,
  ).then((rows) => rows[0]!.id);

  await queryDatabase(async (sql) => {
    await sql`insert into student_wallets (user_id, credits_cents, lifetime_purchased_cents) values (${studentId}, 5000, 5000)`;
    const [purchase] = await sql`
      insert into credit_purchases (user_id, pack_id, paid_cents, credits_cents, provider, status, idempotency_key, settled_at)
      values (${studentId}, 'standard', 5000, 5000, 'mock', 'paid', ${`guard:${studentId}`}, now())
      returning id`;
    await sql`
      insert into ledger_entries (purchase_id, account, owner_id, delta_cents, reason, idempotency_key)
      values (${purchase!.id}, 'student_credits', ${studentId}, 5000, 'credit_purchase',
              ${`purchase:${purchase!.id}:credit`})`;
  });

  const tutorId = await queryDatabase<{ id: string }[]>(
    (sql) => sql`
      select u.id::text as id from tutor_profiles tp join users u on u.id = tp.user_id
      where tp.status = 'verified' order by u.name limit 1
    ` as never,
  ).then((rows) => rows[0]!.id);

  await signOutHard(page);
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));

  await page.goto(`/tutors/${tutorId}?mode=60`);
  await page.getByTestId('calendar-slot').first().click();
  await page.waitForURL(/\/book\?/);

  await page.getByLabel('What should we call you?').fill('Minor Guard');

  // Strip the client-side rule, exactly the way anyone with devtools would.
  await page.getByTestId('guardian-email').evaluate((node) => {
    const input = node as HTMLInputElement;
    input.removeAttribute('required');
    input.value = '';
  });

  await page.getByTestId('confirm-booking').click();
  await page.waitForTimeout(1_000);

  expect(page.url(), 'a minor booked with no guardian on record').not.toMatch(/booked=/);
  await expect(page.getByText(/parent or guardian/i).first()).toBeVisible();
  // And it says whether money moved, because this refusal is money-adjacent.
  await expect(page.getByText(/Nothing has been charged/i)).toBeVisible();

  const booked = await queryDatabase<{ n: number }[]>(
    (sql) => sql`select count(*)::int as n from bookings where student_id = ${studentId}::uuid` as never,
  ).then((rows) => rows[0]!.n);

  expect(booked, 'a booking row exists for a minor with no guardian').toBe(0);
});

/**
 * A slot somebody else is holding.
 *
 * The tutor page already hides slots another student is holding, so this never
 * happens on a freshly loaded calendar. It happens on a page that has been open
 * a minute — a second tab, or one left and come back to — which is most of them.
 *
 * `holdSlot` has always refused this. The refusal was thrown away by the action
 * that called it, so the second student was sent on to the confirm page — and,
 * signed out, to sign up under a banner reading "that time is held for you" —
 * and only found out at the last step. A guard whose answer is discarded is not
 * a guard.
 */
test('a slot held by somebody else is refused at the moment it is picked', async ({ browser }) => {
  // Two contexts and two sign-ins: more than the 60s default.
  test.setTimeout(120_000);

  const first = await browser.newContext();
  const second = await browser.newContext();

  try {
    // Straight to a tutor with hours published. Going through the feed would
    // make a discovery failure look like a hold failure.
    const tutorId = await queryDatabase<{ id: string }[]>(
      (sql) => sql`
        select p.user_id::text as id from tutor_profiles p
        where p.status = 'verified'
          and exists (select 1 from availability_rules r where r.tutor_id = p.user_id and r.active)
        order by p.user_id limit 1
      ` as never,
    ).then((rows) => rows[0]!.id);

    // The rival loads the calendar FIRST, while the slot is genuinely free.
    // This is the whole point: their page is a snapshot, and it goes stale.
    const email = `holdrace.${Date.now().toString(36)}@example.test`;
    const rivalId = await createStudent(email, { creditsCents: 50_000 });
    const rival = await second.newPage();
    await signInWith(rival, email, SEED_PASSWORD);
    await rival.waitForURL((url) => !url.pathname.startsWith('/signin'));
    await rival.goto(`/tutors/${tutorId}`);
    await revealEveryDay(rival);
    const onRivalPage = await rival
      .locator('[data-testid="calendar-slot"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-start')));
    expect(onRivalPage.length, 'the tutor had no free slots to race for').toBeGreaterThan(0);

    // Now somebody else takes one of the times still showing on that page.
    const holder = await first.newPage();
    await signIn(holder, ACCOUNTS.student);
    await holder.goto(`/tutors/${tutorId}`);
    await revealEveryDay(holder);
    const onHolderPage = await holder
      .locator('[data-testid="calendar-slot"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-start')));

    const shared = onHolderPage.find((slot) => onRivalPage.includes(slot));
    expect(shared, 'the two students were shown no slot in common').toBeTruthy();
    const startUtc = shared!;

    await holder.locator(`[data-testid="calendar-slot"][data-start="${startUtc}"]`).first().click();
    await holder.waitForURL(/\/book\?/);

    const held = await queryDatabase<{ n: number }[]>(
      (sql) => sql`
        select count(*)::int as n from slot_holds
        where tutor_id = ${tutorId}::uuid
          and start_at_utc = ${startUtc}::timestamptz
          and expires_at > now()
      ` as never,
    ).then((rows) => rows[0]!.n);
    expect(held, 'the first student did not get a hold').toBe(1);

    // The rival presses the time their stale page still offers.
    await rival.locator(`[data-testid="calendar-slot"][data-start="${startUtc}"]`).first().click();
    await rival.waitForURL(
      (url) =>
        url.href.includes('error=') || url.pathname.includes('/book') || url.pathname.startsWith('/signup'),
      { timeout: 15_000 },
    );

    // Told now, on the calendar — not walked on to the confirm page.
    expect(rival.url(), 'the rival was sent on for a slot they cannot have').not.toMatch(/\/book\?/);
    await expect(rival.getByText(/Somebody else is booking that time/i)).toBeVisible();
    // Picking a slot never touches money, and the message has to say so.
    await expect(rival.getByText(/nothing has been charged/i)).toBeVisible();

    // And no hold was written for them on that slot.
    const rivalHolds = await queryDatabase<{ n: number }[]>(
      (sql) => sql`
        select count(*)::int as n from slot_holds
        where student_id = ${rivalId}::uuid
          and start_at_utc = ${startUtc}::timestamptz
          and expires_at > now()
      ` as never,
    ).then((rows) => rows[0]!.n);
    expect(rivalHolds, 'a second hold exists on a slot already held').toBe(0);
  } finally {
    await first.close();
    await second.close();
  }
});
