/**
 * Credits and booking (SPEC.md §2, §5) — phase 3, checkpoint B.
 *
 * The line this suite has to hold is the one the whole product stands on: a
 * student buys credits, books a session, and the cents end up exactly where
 * they should. Everything else here is a way that could quietly go wrong —
 * a webhook delivered three times, two people taking one slot, a rate change
 * reaching a booking that was already priced.
 */

import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, test, type Page } from '@playwright/test';

import { ACCOUNTS, SEED_PASSWORD, queryDatabase, revealEveryDay, signIn, signOut } from './helpers';

const run = promisify(execFile);
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** The same header and algorithm `MockPaymentProvider` verifies. */
const SIGNATURE_HEADER = 'x-tutorly-signature';

function sign(body: string): string {
  return createHmac('sha256', process.env.AUTH_SECRET ?? 'development-secret').update(body).digest('hex');
}

async function creditsFor(email: string): Promise<number> {
  const rows = await queryDatabase<{ credits: number }[]>(
    (sql) => sql`
      select w.credits_cents::int as credits
      from student_wallets w join users u on u.id = w.user_id
      where u.email = ${email}
    ` as never,
  );
  return rows[0]?.credits ?? 0;
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
}

/**
 * Picks a bookable slot at least this many hours out.
 *
 * Rescheduling is only allowed more than twelve hours before a session, so a
 * test about moving one has to book something far enough away — the first free
 * slot on the calendar is often this evening.
 */
async function slotAtLeastHoursAway(page: Page, hours: number): Promise<string> {
  const slots = page.getByTestId('calendar-slot');
  await expect(slots.first()).toBeVisible();

  // The slot this returns is usually a day or two out, which is behind the
  // fold. Open it so the caller can click what it is handed.
  await revealEveryDay(page);

  const cutoff = Date.now() + hours * 3_600_000;
  const starts = await slots.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-start') ?? ''),
  );

  const found = starts.find((start) => start && new Date(start).getTime() > cutoff);
  expect(found, `no free slot more than ${hours} hours away`).toBeTruthy();
  return found!;
}

/** A verified tutor with hours published who this student has never booked. */
async function bookableTutor(): Promise<{ id: string; email: string; name: string; hourly: number }> {
  const rows = await queryDatabase<{ id: string; email: string; name: string; hourly: number }[]>(
    (sql) => sql`
      select u.id::text, u.email, u.name, p.hourly_cents::int as hourly
      from tutor_profiles p
      join users u on u.id = p.user_id
      where p.status = 'verified'
        and u.suspended_at is null
        and p.hourly_cents <= 8000
        and exists (select 1 from availability_rules r where r.tutor_id = p.user_id and r.active)
        and not exists (
          select 1 from bookings b join users s on s.id = b.student_id
          where b.tutor_id = p.user_id and s.email = ${ACCOUNTS.student} and not b.is_trial
        )
      order by p.hourly_cents asc
      limit 1
    ` as never,
  );

  expect(rows.length, 'the seed should leave a bookable tutor').toBeGreaterThan(0);
  return rows[0]!;
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

test.describe('buying credits', () => {
  test.describe.configure({ mode: 'serial' });

  test('a student buys a pack and the credits arrive', async ({ page }) => {
    const before = await creditsFor(ACCOUNTS.student);

    await signIn(page, ACCOUNTS.student);
    await page.goto('/credits');

    await expect(page.getByTestId('credit-pack').first()).toBeVisible();
    await page.getByTestId('buy-standard').click();

    // The development provider's page, which posts the webhook a real one would.
    await page.waitForURL(/\/credits\/checkout\//);
    await expect(page.getByText('Nothing is charged and no money moves')).toBeVisible();
    await page.getByTestId('pay-now').click();

    await page.waitForURL(/credited=1/);
    // $25 buys $25: the bonus starts at $50 now.
    expect(await creditsFor(ACCOUNTS.student)).toBe(before + 2_500);

    const [purchase] = await queryDatabase<{ status: string; entries: number }[]>(
      (sql) => sql`
        select p.status,
               (select count(*)::int from ledger_entries l where l.purchase_id = p.id) as entries
        from credit_purchases p join users u on u.id = p.user_id
        where u.email = ${ACCOUNTS.student}
        order by p.created_at desc limit 1
      ` as never,
    );

    expect(purchase?.status).toBe('paid');
    expect(purchase?.entries).toBe(1);
  });

  test('the same webhook delivered three times credits once', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await page.goto('/credits');
    await page.getByTestId('buy-starter').click();
    await page.waitForURL(/\/credits\/checkout\//);

    const purchaseId = page.url().split('/credits/checkout/')[1]!.split('?')[0]!;
    const before = await creditsFor(ACCOUNTS.student);

    const body = JSON.stringify({
      kind: 'paid',
      purchaseId,
      paidCents: 1_000,
      providerRef: `mock_${purchaseId.slice(0, 8)}`,
      eventId: `evt_${purchaseId}`,
    });

    // Three real deliveries, in flight at the same time — which is how a
    // provider's retries actually arrive, and the case a check-then-act loses.
    const responses = await Promise.all(
      [0, 1, 2].map(() =>
        fetch(`${BASE_URL}/api/payments/webhook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign(body) },
          body,
        }),
      ),
    );

    for (const response of responses) expect(response.status).toBe(200);

    const outcomes = await Promise.all(responses.map((response) => response.json()));
    expect(outcomes.filter((outcome) => outcome.applied === true)).toHaveLength(1);

    // One purchase, one ledger entry, one lot of credits.
    expect(await creditsFor(ACCOUNTS.student)).toBe(before + 1_000);

    const [counts] = await queryDatabase<{ purchases: number; entries: number }[]>(
      (sql) => sql`
        select count(*)::int as purchases,
               (select count(*)::int from ledger_entries where purchase_id = ${purchaseId}::uuid) as entries
        from credit_purchases where id = ${purchaseId}::uuid
      ` as never,
    );

    expect(counts?.purchases).toBe(1);
    expect(counts?.entries).toBe(1);
  });

  test('an unsigned or tampered webhook is refused', async () => {
    const body = JSON.stringify({ kind: 'paid', purchaseId: 'x', paidCents: 100 });

    const unsigned = await fetch(`${BASE_URL}/api/payments/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(unsigned.status).toBe(401);

    const tampered = await fetch(`${BASE_URL}/api/payments/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign(body) },
      body: body.replace('100', '100000'),
    });
    expect(tampered.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

test.describe('booking a session', () => {
  test.describe.configure({ mode: 'serial' });

  test('books 60 minutes, and the money lands in escrow', async ({ page }) => {
    const tutor = await bookableTutor();
    const before = await creditsFor(ACCOUNTS.student);

    await signIn(page, ACCOUNTS.student);
    await page.goto(`/tutors/${tutor.id}?mode=60`);

    const slot = page.getByTestId('calendar-slot').first();
    await expect(slot).toBeVisible();
    await slot.click();

    // The paywall moved: picking a time holds it and shows the price, the
    // balance and the commit together. Nothing has been charged yet.
    await page.waitForURL(/\/book\?/);
    await expect(page.getByTestId('booking-price')).toBeVisible();
    await expect(page.getByTestId('hold-notice')).toBeVisible();
    expect(await creditsFor(ACCOUNTS.student)).toBe(before);

    await page.getByTestId('confirm-booking').click();

    await page.waitForURL(/\/dashboard\?booked=/);
    const bookingId = page.url().split('booked=')[1]!;

    const [booking] = await queryDatabase<
      {
        status: string;
        price: number;
        commission: number;
        duration: number;
        escrow: number;
        debit: number;
      }[]
    >(
      (sql) => sql`
        select b.status, b.price_cents::int as price, b.commission_bps::int as commission,
               b.duration_minutes::int as duration,
               (select coalesce(sum(delta_cents), 0)::int from ledger_entries
                 where booking_id = b.id and account = 'escrow') as escrow,
               (select coalesce(sum(delta_cents), 0)::int from ledger_entries
                 where booking_id = b.id and account = 'student_credits') as debit
        from bookings b where b.id = ${bookingId}::uuid
      ` as never,
    );

    expect(booking?.status).toBe('confirmed');
    expect(booking?.duration).toBe(60);
    // The price came out of the wallet and is sitting in escrow, to the cent.
    expect(booking!.escrow).toBe(booking!.price);
    expect(booking!.debit).toBe(-booking!.price);
    expect(await creditsFor(ACCOUNTS.student)).toBe(before - booking!.price);

    // A student's first paid session with this tutor: 22%.
    expect(booking?.commission).toBe(2_200);
  });

  test('a rate change afterwards cannot reprice it', async () => {
    const [booking] = await queryDatabase<{ id: string; price: number; tutor_id: string }[]>(
      (sql) => sql`
        select b.id::text, b.price_cents::int as price, b.tutor_id::text
        from bookings b join users s on s.id = b.student_id
        where s.email = ${ACCOUNTS.student} and b.status = 'confirmed' and not b.is_trial
        order by b.created_at desc limit 1
      ` as never,
    );

    await queryDatabase(
      (sql) => sql`
        update tutor_profiles set hourly_cents = hourly_cents + 2000
        where user_id = ${booking!.tutor_id}::uuid
      ` as never,
    );

    const [after] = await queryDatabase<{ price: number }[]>(
      (sql) => sql`select price_cents::int as price from bookings where id = ${booking!.id}::uuid` as never,
    );

    expect(after?.price).toBe(booking!.price);
  });

  test('a returning student is worth more to their tutor: 16% instead of 22%', async () => {
    // A pair with a session that actually happened is charged the rebooking
    // rate on the next one (SPEC.md §2, amended).
    const [pair] = await queryDatabase<{ student_id: string; tutor_id: string }[]>(
      (sql) => sql`
        select student_id::text, tutor_id::text from bookings
        where completed_at is not null and not is_trial
        limit 1
      ` as never,
    );

    const [next] = await queryDatabase<{ commission: number }[]>(
      (sql) => sql`
        select commission_bps::int as commission from bookings
        where student_id = ${pair!.student_id}::uuid and tutor_id = ${pair!.tutor_id}::uuid
        order by created_at desc limit 1
      ` as never,
    );

    // The seeded history spans a repricing, so assert the rule rather than the
    // seed: whatever the old bookings carry, a fresh one for this pair is at a
    // rebooking rate, never a first-booking one.
    expect([1_500, 1_600, 2_000, 2_200]).toContain(next?.commission);

    const { stdout } = await run('pnpm', ['prove:commission', pair!.student_id, pair!.tutor_id], {
      cwd: process.cwd(),
      timeout: 60_000,
    });
    // 16% unless this tutor negotiated something lower, which is a floor.
    const quoted = JSON.parse(stdout.slice(stdout.indexOf('{'))).commissionBps as number;
    expect(quoted).toBeLessThanOrEqual(1_600);
  });

  test('two clients taking one slot at once produce exactly one booking', async () => {
    const { stdout } = await run('pnpm', ['prove:booking', '--clients', '4'], {
      cwd: process.cwd(),
      timeout: 120_000,
    });

    const result = JSON.parse(stdout.slice(stdout.indexOf('{')));

    expect(result.clients).toBe(4);
    expect(result.succeeded).toBe(1);
    expect(result.bookingsInDatabase).toBe(1);
    expect(result.escrowEntries).toBe(1);
    expect(result.failures).toEqual(['slot_taken', 'slot_taken', 'slot_taken']);
  });
});

// ---------------------------------------------------------------------------
// Not enough credits
// ---------------------------------------------------------------------------

test('a short balance holds the slot while the student tops up', async ({ page }) => {
  // A student with almost nothing, so the shortfall path is the real one.
  const [poor] = await queryDatabase<{ email: string; credits: number }[]>(
    (sql) => sql`
      select u.email, w.credits_cents::int as credits
      from student_wallets w join users u on u.id = w.user_id
      where 'student' = any(u.roles)
        and not exists (select 1 from tutor_profiles p where p.user_id = u.id)
        and w.credits_cents < 500
      order by w.credits_cents asc limit 1
    ` as never,
  );

  const tutor = await bookableTutor();

  await signInAs(page, poor!.email);
  await page.goto(`/tutors/${tutor.id}?mode=60`);

  const slot = page.getByTestId('calendar-slot').first();
  await expect(slot).toBeVisible();
  const startUtc = await slot.getAttribute('data-start');
  await slot.click();

  // No detour to a separate credits page: the top-up is on the booking page,
  // the shortfall is named, and the slot is kept while they buy.
  await page.waitForURL(/\/book\?/);
  await expect(page.getByTestId('inline-top-up')).toBeVisible();
  await expect(page.getByText(/You need .* more/)).toBeVisible();
  await expect(page.getByTestId('hold-notice')).toBeVisible();
  await expect(page.getByTestId('confirm-booking')).toBeDisabled();

  const [hold] = await queryDatabase<{ total: number }[]>(
    (sql) => sql`
      select count(*)::int as total from slot_holds h
      join users u on u.id = h.student_id
      where u.email = ${poor!.email}
        and h.tutor_id = ${tutor.id}::uuid
        and h.start_at_utc = ${startUtc}::timestamptz
        and h.expires_at > now()
    ` as never,
  );
  expect(hold?.total).toBe(1);

  // Nobody else is offered it while the hold is live.
  await signOut(page);
  await signIn(page, ACCOUNTS.student);
  await page.goto(`/tutors/${tutor.id}?mode=60`);
  await expect(page.locator(`[data-testid="calendar-slot"][data-start="${startUtc}"]`)).toHaveCount(0);

  // Expiry is read-time: age the hold out and it is offered again, with no
  // sweeper having run.
  await queryDatabase(
    (sql) => sql`update slot_holds set expires_at = now() - interval '1 minute'` as never,
  );

  await page.reload();
  await expect(page.locator(`[data-testid="calendar-slot"][data-start="${startUtc}"]`)).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// Rescheduling
// ---------------------------------------------------------------------------

test.describe('moving a session', () => {
  test.describe.configure({ mode: 'serial' });

  test('the student asks, the tutor agrees, and it moves once', async ({ page }) => {
    const tutor = await bookableTutor();

    // A fresh booking well outside the twelve-hour cutoff.
    await signIn(page, ACCOUNTS.student);
    await page.goto(`/tutors/${tutor.id}?mode=60`);
    const start = await slotAtLeastHoursAway(page, 13);
    await page.locator(`[data-testid="calendar-slot"][data-start="${start}"]`).click();
    await page.waitForURL(/\/book\?/);
    await page.getByTestId('confirm-booking').click();
    await page.waitForURL(/\/dashboard\?booked=/);
    const bookingId = page.url().split('booked=')[1]!;

    const [original] = await queryDatabase<{ start: string }[]>(
      (sql) => sql`select start_at_utc::text as start from bookings where id = ${bookingId}::uuid` as never,
    );

    await page.goto('/dashboard');
    const row = page.locator(`[data-booking-id="${bookingId}"]`);
    await row.getByText('Cancel or move this session').click();

    const form = row.locator('form', { has: page.getByTestId('request-reschedule') });
    await expect(form).toBeVisible();

    // Anything other than the time it is already at.
    const options = await form.locator('select[name="newStartUtc"] option').all();
    const values = await Promise.all(options.map((option) => option.getAttribute('value')));
    const target = values.find((value) => value && !original!.start.startsWith(value.slice(0, 16)));
    expect(target, 'the tutor should have another free slot to move to').toBeTruthy();

    await form.locator('select[name="newStartUtc"]').selectOption(target!);
    await form.getByTestId('request-reschedule').click();
    await expect(page.getByText(/Requests to move a session/)).toBeVisible();

    // The original time still stands until the other side agrees.
    const [unchanged] = await queryDatabase<{ start: string; count: number }[]>(
      (sql) => sql`
        select start_at_utc::text as start, reschedule_count::int as count
        from bookings where id = ${bookingId}::uuid
      ` as never,
    );
    expect(unchanged?.start).toBe(original?.start);
    expect(unchanged?.count).toBe(0);

    // The tutor agrees.
    await signOut(page);
    await signInAs(page, tutor.email);
    await page.goto('/tutor');
    await page.getByTestId('accept-reschedule').first().click();
    await expect(page.getByText('the session has moved')).toBeVisible();

    const [moved] = await queryDatabase<{ start: string; count: number }[]>(
      (sql) => sql`
        select start_at_utc::text as start, reschedule_count::int as count
        from bookings where id = ${bookingId}::uuid
      ` as never,
    );

    expect(moved?.start).not.toBe(original?.start);
    expect(moved?.count).toBe(1);

    // And only once.
    await signOut(page);
    await signIn(page, ACCOUNTS.student);
    await page.goto('/dashboard');
    const movedRow = page.locator(`[data-booking-id="${bookingId}"]`);
    await movedRow.getByText('Cancel or move this session').click();
    await expect(movedRow.getByText('already been moved once')).toBeVisible();
  });

  test('a request nobody answers lapses, and cannot be accepted afterwards', async ({ page }) => {
    const tutor = await bookableTutor();

    await signIn(page, ACCOUNTS.student);
    await page.goto(`/tutors/${tutor.id}?mode=60`);
    const start = await slotAtLeastHoursAway(page, 13);
    await page.locator(`[data-testid="calendar-slot"][data-start="${start}"]`).click();
    await page.waitForURL(/\/book\?/);
    await page.getByTestId('confirm-booking').click();
    await page.waitForURL(/\/dashboard\?booked=/);
    const bookingId = page.url().split('booked=')[1]!;

    await page.goto('/dashboard');
    const row = page.locator(`[data-booking-id="${bookingId}"]`);
    await row.getByText('Cancel or move this session').click();
    const form = row.locator('form', { has: page.getByTestId('request-reschedule') });
    await form.getByTestId('request-reschedule').click();
    await expect(page.getByText(/Requests to move a session/)).toBeVisible();

    // Age it past the six-hour window. Nothing sweeps; the next read decides.
    await queryDatabase(
      (sql) => sql`
        update reschedule_requests set created_at = now() - interval '7 hours'
        where booking_id = ${bookingId}::uuid and status = 'pending'
      ` as never,
    );

    await signOut(page);
    await signInAs(page, tutor.email);
    await page.goto('/tutor');

    // Reading the page is what expires it, so there is nothing left to accept.
    await expect(page.getByTestId('reschedule-request')).toHaveCount(0);

    const [request] = await queryDatabase<{ status: string }[]>(
      (sql) => sql`
        select status from reschedule_requests where booking_id = ${bookingId}::uuid
        order by created_at desc limit 1
      ` as never,
    );
    expect(request?.status).toBe('expired');
  });
});

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

test.describe('disputes', () => {
  test.describe.configure({ mode: 'serial' });

  test('reporting a problem freezes settlement until an admin decides', async ({ page }) => {
    // A session that has happened and is still inside its 24-hour window.
    const [reportable] = await queryDatabase<{ email: string }[]>(
      (sql) => sql`
        select u.email
        from bookings b join users u on u.id = b.student_id
        where b.settled_at is null and not b.is_trial and b.price_cents > 0
          and b.status <> 'disputed'
          and b.start_at_utc + make_interval(mins => b.duration_minutes) < now()
          and b.start_at_utc + make_interval(mins => b.duration_minutes) > now() - interval '24 hours'
        limit 1
      ` as never,
    );

    expect(reportable, 'the seed should leave a session inside its dispute window').toBeTruthy();

    await signInAs(page, reportable!.email);
    await page.goto('/dashboard');

    // The controls live behind a disclosure, so opening it is part of the flow.
    await page.getByText('Something went wrong with this session').first().click();

    const form = page.locator('form', { has: page.getByTestId('report-problem') }).first();
    await form.getByPlaceholder('They never joined / the audio failed / …').fill('The tutor never turned up.');
    await form.getByTestId('report-problem').click();

    await expect(page.getByText(/Nothing settles on that session/)).toBeVisible();

    const [disputed] = await queryDatabase<{ id: string; status: string; due: string }[]>(
      (sql) => sql`
        select b.id::text, b.status,
               (b.start_at_utc + make_interval(mins => b.duration_minutes)
                 + interval '24 hours' + interval '5 minutes')::text as due
        from bookings b
        join users u on u.id = b.student_id
        where u.email = ${reportable!.email} and b.status = 'disputed'
        order by b.updated_at desc limit 1
      ` as never,
    );

    expect(disputed?.status).toBe('disputed');

    // Settlement no longer sees it. Asked as a dry run at the moment it would
    // otherwise have been due — actually settling at a future date would sweep
    // every other booking in the database and prove nothing about this one.
    const { stdout } = await run(
      'pnpm',
      ['settle', '--at', new Date(disputed!.due).toISOString(), '--dry-run'],
      { cwd: process.cwd(), timeout: 120_000 },
    );

    const preview = JSON.parse(stdout.slice(stdout.indexOf('{')));
    expect(preview.due.map((row: { bookingId: string }) => row.bookingId)).not.toContain(disputed!.id);

    const [frozen] = await queryDatabase<{ status: string; settled: string | null }[]>(
      (sql) => sql`
        select status, settled_at::text as settled from bookings where id = ${disputed!.id}::uuid
      ` as never,
    );
    expect(frozen?.status).toBe('disputed');
    expect(frozen?.settled).toBeNull();
  });

  test('an admin resolves it, and the money moves', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.goto('/admin/moderation');

    const dispute = page.getByTestId('dispute').first();
    await expect(dispute).toBeVisible();

    await dispute.getByPlaceholder('What did you decide, and why?').fill('Tutor confirmed they missed it.');
    await dispute.getByTestId('dispute-refund').click();

    await expect(page.getByTestId('dispute')).toHaveCount(0);

    const [audit] = await queryDatabase<{ action: string; reason: string }[]>(
      (sql) => sql`
        select action, reason from admin_audit where action like 'dispute.%'
        order by created_at desc limit 1
      ` as never,
    );
    expect(audit?.action).toBe('dispute.refund');
    expect(audit?.reason).toBe('Tutor confirmed they missed it.');
  });
});

test('the ledger still reconciles to zero drift', async () => {
  const { stdout } = await run('pnpm', ['reconcile'], { cwd: process.cwd(), timeout: 120_000 });
  expect(stdout).toContain('zero drift');
});
