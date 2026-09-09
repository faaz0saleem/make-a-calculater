/**
 * Phase 9: getting back in, and proving who you are.
 *
 * Two flows that did not exist before this phase, driven the way a locked-out
 * person drives them — including the parts that are supposed to fail. What is
 * under test is not "the happy path renders" but the four properties the
 * design turns on: the link works once, it expires, it kills every session
 * that existed before it, and it touches no money.
 */

import { expect, test } from '@playwright/test';

import {
  createStudent,
  latestEmailLink,
  ownIp,
  queryDatabase,
  SEED_PASSWORD,
  signIn,
  signInWith,
  signOut,
} from './helpers';

test.describe.configure({ mode: 'serial' });

/** Fresh addresses per run, so a second run does not collide with the first. */
const RUN = Date.now().toString(36);
const RESET_EMAIL = `reset.${RUN}@example.test`;
const CHANGE_EMAIL = `change.${RUN}@example.test`;
const VERIFY_EMAIL = `verify.${RUN}@example.test`;

const NEW_PASSWORD = 'brand-new-pass-9';

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

test('a reset link arrives, works once, and does not touch the money', async ({ browser }) => {
  const userId = await createStudent(RESET_EMAIL, { creditsCents: 4_000 });

  // Somebody signed in on another device, who must be signed out by the reset.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, RESET_EMAIL);
  await otherPage.goto('/dashboard');
  await expect(otherPage).toHaveURL(/\/dashboard/);

  const before = await queryDatabase(async (sql) => {
    const [wallet] = await sql`select credits_cents from student_wallets where user_id = ${userId}`;
    const [ledger] = await sql`select count(*)::int as n from ledger_entries where owner_id = ${userId}`;
    return { credits: Number(wallet!.credits_cents), entries: Number(ledger!.n) };
  });
  expect(before.credits).toBe(4_000);

  const context = await browser.newContext();
  const page = await context.newPage();
  await ownIp(page);

  // --- Asking -------------------------------------------------------------
  await page.goto('/forgot-password');
  await page.getByLabel('Your email').fill(RESET_EMAIL);
  await page.getByTestId('request-reset').click();
  await expect(page.getByTestId('reset-sent')).toBeVisible();

  const link = await latestEmailLink(RESET_EMAIL, 'password_reset', 'resetUrl');
  expect(link, 'a reset email should have been queued').not.toBeNull();

  const token = link!.split('/reset-password/')[1]!;
  expect(token.length).toBeGreaterThan(20);

  // The row stores a hash, never the token. A database dump must not contain
  // working keys to anybody's account.
  const stored = await queryDatabase(async (sql) => {
    const rows = await sql`select token_hash, used_at, expires_at from password_resets where user_id = ${userId}`;
    return rows;
  });
  expect(stored).toHaveLength(1);
  expect(String(stored[0]!.token_hash)).not.toContain(token);
  expect(String(stored[0]!.token_hash)).toMatch(/^[0-9a-f]{64}$/);
  expect(stored[0]!.used_at).toBeNull();

  // --- Using --------------------------------------------------------------
  await page.goto(`/reset-password/${token}`);

  // Mistyping the confirmation does not consume the link.
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByLabel('Type it again').fill('something-else-1');
  await page.getByTestId('set-password').click();
  await expect(page.getByTestId('reset-error')).toContainText('do not match');

  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByLabel('Type it again').fill(NEW_PASSWORD);
  await page.getByTestId('set-password').click();
  await expect(page).toHaveURL(/\/signin\?reset=1/);
  await expect(page.getByTestId('reset-done')).toContainText('signed out everywhere else');

  // --- The four properties -------------------------------------------------

  // 1. The old password is dead, the new one works.
  await signInWith(page, RESET_EMAIL, SEED_PASSWORD);
  await expect(page.getByText('We could not sign you in')).toBeVisible();

  await signInWith(page, RESET_EMAIL, NEW_PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));

  // 2. The session that existed before the reset is gone. The cookie is still
  //    in that browser; it is refused because the token predates the reset.
  await otherPage.goto('/dashboard');
  await expect(otherPage).toHaveURL(/\/signin/);

  // 3. The link is single use.
  await page.goto(`/reset-password/${token}`);
  await page.getByLabel('New password').fill('another-one-here-2');
  await page.getByLabel('Type it again').fill('another-one-here-2');
  await page.getByTestId('set-password').click();
  await expect(page.getByTestId('reset-error')).toContainText('not usable');

  // 4. Nothing about the money moved.
  const after = await queryDatabase(async (sql) => {
    const [wallet] = await sql`select credits_cents from student_wallets where user_id = ${userId}`;
    const [ledger] = await sql`select count(*)::int as n from ledger_entries where owner_id = ${userId}`;
    return { credits: Number(wallet!.credits_cents), entries: Number(ledger!.n) };
  });
  expect(after).toEqual(before);

  await other.close();
  await context.close();
});

test('the reset endpoint does not say which addresses exist', async ({ page }) => {
  const stranger = `nobody.${RUN}@example.test`;
  await ownIp(page);

  await page.goto('/forgot-password');
  await page.getByLabel('Your email').fill(stranger);
  await page.getByTestId('request-reset').click();

  // Word for word what a real address gets.
  await expect(page.getByTestId('reset-sent')).toBeVisible();
  await expect(page.getByText('If that address has an account')).toBeVisible();

  const queued = await queryDatabase(async (sql) => {
    const [row] = await sql`select count(*)::int as n from email_deliveries where lower(to_email) = ${stranger}`;
    return Number(row!.n);
  });
  expect(queued, 'nothing should be sent to an address with no account').toBe(0);
});

test('an expired link is refused', async ({ page }) => {
  const email = `expired.${RUN}@example.test`;
  await createStudent(email);
  await ownIp(page);

  await page.goto('/forgot-password');
  await page.getByLabel('Your email').fill(email);
  await page.getByTestId('request-reset').click();
  await expect(page.getByTestId('reset-sent')).toBeVisible();

  const link = await latestEmailLink(email, 'password_reset', 'resetUrl');
  const token = link!.split('/reset-password/')[1]!;

  // Reach back past the 30-minute window rather than waiting out the clock.
  await queryDatabase(
    (sql) => sql`update password_resets set expires_at = now() - interval '1 minute'`,
  );

  await page.goto(`/reset-password/${token}`);
  await page.getByLabel('New password').fill('too-late-for-this-1');
  await page.getByLabel('Type it again').fill('too-late-for-this-1');
  await page.getByTestId('set-password').click();
  await expect(page.getByTestId('reset-error')).toContainText('not usable');
});

// ---------------------------------------------------------------------------
// Changing a password from inside the account
// ---------------------------------------------------------------------------

test('changing a password needs the current one, and drops other sessions', async ({ browser }) => {
  await createStudent(CHANGE_EMAIL);

  const laptop = await browser.newContext();
  const laptopPage = await laptop.newPage();
  await signIn(laptopPage, CHANGE_EMAIL);

  const phone = await browser.newContext();
  const phonePage = await phone.newPage();
  await signIn(phonePage, CHANGE_EMAIL);
  await phonePage.goto('/dashboard');
  await expect(phonePage).toHaveURL(/\/dashboard/);

  await laptopPage.goto('/settings/password');

  // The wrong current password changes nothing.
  await laptopPage.getByLabel('Current password').fill('not-the-password');
  await laptopPage.getByLabel('New password').fill(NEW_PASSWORD);
  await laptopPage.getByLabel('Type it again').fill(NEW_PASSWORD);
  await laptopPage.getByTestId('change-password').click();
  await expect(laptopPage.getByTestId('password-error')).toContainText('not your current password');

  // Nor does re-using the one you already have.
  await laptopPage.getByLabel('Current password').fill(SEED_PASSWORD);
  await laptopPage.getByLabel('New password').fill(SEED_PASSWORD);
  await laptopPage.getByLabel('Type it again').fill(SEED_PASSWORD);
  await laptopPage.getByTestId('change-password').click();
  await expect(laptopPage.getByTestId('password-error')).toContainText('already have');

  await laptopPage.getByLabel('Current password').fill(SEED_PASSWORD);
  await laptopPage.getByLabel('New password').fill(NEW_PASSWORD);
  await laptopPage.getByLabel('Type it again').fill(NEW_PASSWORD);
  await laptopPage.getByTestId('change-password').click();
  await expect(laptopPage.getByTestId('password-changed')).toBeVisible();

  // The phone is signed out; the laptop the change was made on is not, because
  // signing somebody out of the device they are typing on is a poor way to
  // confirm that anything worked.
  await phonePage.goto('/dashboard');
  await expect(phonePage).toHaveURL(/\/signin/);

  await laptopPage.goto('/dashboard');
  await expect(laptopPage).toHaveURL(/\/dashboard/);

  await laptop.close();
  await phone.close();
});

// ---------------------------------------------------------------------------
// Email verification: a nudge, and two gates
// ---------------------------------------------------------------------------

test('an unverified student is nudged, not blocked', async ({ page }) => {
  await createStudent(VERIFY_EMAIL, { emailVerified: false, creditsCents: 0 });
  await signIn(page, VERIFY_EMAIL);

  // The banner names the address and says what it actually affects.
  await page.goto('/dashboard');
  await expect(page.getByTestId('verify-banner')).toContainText(VERIFY_EMAIL);
  await expect(page.getByTestId('verify-banner')).toContainText('$25.00');

  // Browsing and opening a tutor still work — that is the whole decision.
  await page.goto('/');
  await expect(page.getByTestId('tutor-card').first()).toBeVisible();

  // Small packs are buyable; the ones over the threshold say why they are not.
  await page.goto('/credits');
  // $5, $10 and $25 are fine; $50 and $100 are not.
  await expect(page.getByTestId('buy-taste')).toBeEnabled();
  await expect(page.getByTestId('buy-standard')).toBeEnabled();
  await expect(page.getByTestId('buy-plus')).toBeDisabled();
  await expect(page.getByTestId('buy-pro')).toBeDisabled();
  await expect(page.getByTestId('blocked-plus')).toContainText('confirmed email');
});

test('the server refuses a large purchase even when the button is bypassed', async ({ page }) => {
  await signIn(page, VERIFY_EMAIL);
  await page.goto('/credits');

  // Enable the disabled button and press it: the screen is a courtesy, and the
  // check that counts is the one in `startPurchase`.
  await page.getByTestId('buy-plus').evaluate((node) => {
    (node as HTMLButtonElement).disabled = false;
  });
  await page.getByTestId('buy-plus').click();

  await expect(page).toHaveURL(/\/credits\?error=/);
  await expect(page.getByText('Confirm your email address before a purchase')).toBeVisible();
});

test('confirming opens the gates, and the link works once', async ({ page }) => {
  await ownIp(page);
  await signIn(page, VERIFY_EMAIL);

  await page.goto('/settings/email');
  await expect(page.getByTestId('email-unverified')).toBeVisible();
  await page.getByTestId('resend-verification').click();
  await expect(page.getByTestId('email-saved')).toContainText('Sent');

  const link = await latestEmailLink(VERIFY_EMAIL, 'email_verification', 'verifyUrl');
  expect(link).not.toBeNull();
  const token = link!.split('/verify-email/')[1]!;

  await page.goto(`/verify-email/${token}`);
  await expect(page.getByTestId('verify-ok')).toContainText('Email confirmed');

  // The nudge is gone and the gate is open.
  await page.goto('/credits');
  await expect(page.getByTestId('verify-banner')).toHaveCount(0);
  await expect(page.getByTestId('buy-plus')).toBeEnabled();

  // The same link a second time is refused rather than silently re-confirming.
  await page.goto(`/verify-email/${token}`);
  await expect(page.getByTestId('verify-failed')).toBeVisible();
});

test('an unverified tutor cannot request a payout', async ({ page }) => {
  // The seed's `payout.ready` tutor has exactly the threshold available and no
  // open request, so the form is on screen and the only thing in the way is
  // the address. Take the confirmation away to reach the gate.
  const tutor = 'payout.ready@tutorly.test';
  await queryDatabase(
    (sql) => sql`update users set email_verified_at = null where email = ${tutor}`,
  );

  await signIn(page, tutor);
  await page.goto('/tutor/earnings');

  await expect(page.getByTestId('payout-unverified')).toContainText('Confirm your email address');
  await expect(page.getByTestId('request-payout')).toBeDisabled();

  // The screen is a courtesy. Post the form anyway: the refusal that counts is
  // inside the same transaction that would have moved the money.
  await page.getByTestId('request-payout').evaluate((node) => {
    (node as HTMLButtonElement).disabled = false;
  });
  await page.getByTestId('request-payout').click();
  await expect(page.getByText('Confirm your email address before your first payout')).toBeVisible();

  const created = await queryDatabase(async (sql) => {
    const [row] = await sql`
      select count(*)::int as n from payouts
      where tutor_id = (select id from users where email = ${tutor})
    `;
    return Number(row!.n);
  });
  expect(created, 'no payout row should exist for a refused request').toBe(0);

  // Confirmed again, the same button works.
  await queryDatabase(
    (sql) => sql`update users set email_verified_at = now() where email = ${tutor}`,
  );

  await page.goto('/tutor/earnings');
  await expect(page.getByTestId('payout-unverified')).toHaveCount(0);
  await expect(page.getByTestId('request-payout')).toBeEnabled();
});

test('the banner can be put away, and changing the address brings it back', async ({ page }) => {
  const email = `banner.${RUN}@example.test`;
  const newAddress = `banner.moved.${RUN}@example.test`;
  await createStudent(email, { emailVerified: false });
  await signIn(page, email);

  await page.goto('/dashboard');
  await expect(page.getByTestId('verify-banner')).toBeVisible();
  await page.getByTestId('verify-dismiss').click();
  await expect(page.getByTestId('verify-banner')).toHaveCount(0);

  await page.goto('/settings/curriculum');
  await expect(page.getByTestId('verify-banner')).toHaveCount(0);

  // Changing the address needs the password, and re-arms everything.
  await page.goto('/settings/email');
  await page.getByText('Use a different address').click();
  await page.getByLabel('New address').fill(newAddress);
  await page.getByLabel('Your password').fill('not-the-password');
  await page.getByTestId('change-email').click();
  await expect(page.getByTestId('email-error')).toContainText('not your current password');

  await page.getByText('Use a different address').click();
  await page.getByLabel('New address').fill(newAddress);
  await page.getByLabel('Your password').fill(SEED_PASSWORD);
  await page.getByTestId('change-email').click();
  await expect(page.getByTestId('email-saved')).toContainText('Address changed');

  // The header and the banner both show the new address, and a link is waiting.
  await expect(page.getByTestId('account-email')).toHaveText(newAddress);
  await expect(page.getByTestId('verify-banner')).toContainText(newAddress);

  const link = await latestEmailLink(newAddress, 'email_verification', 'verifyUrl');
  expect(link, 'changing an address should send a new confirmation').not.toBeNull();

  // And it is the new address that signs in from now on.
  await signOut(page);
  await signInWith(page, newAddress, SEED_PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
});
