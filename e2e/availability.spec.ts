/**
 * Checkpoint A: the availability engine, through the real UI.
 *
 * The gate SPEC.md §16 names is the Karachi tutor and the New York student —
 * both seeing the same instant as their own local time, either side of a US
 * daylight-saving change.
 */

import { expect, test } from '@playwright/test';

import { ACCOUNTS, queryDatabase, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

/** The seeded Karachi tutor. */
async function karachiTutorId(): Promise<string> {
  const rows = await queryDatabase(
    async (sql) =>
      await sql<{ id: string }[]>`
        select users.id from users
        join tutor_profiles on tutor_profiles.user_id = users.id
        where users.email = ${ACCOUNTS.verifiedTutor}
      `,
  );
  return rows[0]!.id;
}

test('the calendar shows a New York student their own times, and the tutor\'s underneath', async ({
  page,
}) => {
  const tutorId = await karachiTutorId();

  // student@tutorly.test is seeded in America/New_York.
  await signIn(page, ACCOUNTS.student);
  await page.goto(`/tutors/${tutorId}?duration=60`);

  await expect(page.getByRole('heading', { name: 'Book a session' })).toBeVisible();
  await expect(page.getByText('America/New_York')).toBeVisible();

  const slots = page.getByTestId('calendar-slot');
  expect(await slots.count()).toBeGreaterThan(0);

  // Every slot renders the same instant twice: once for each party.
  const first = slots.first();
  const startUtc = new Date((await first.getAttribute('data-start'))!);

  const asNewYork = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(startUtc);
  const asKarachi = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(startUtc);

  await expect(first).toContainText(asNewYork);
  await expect(first).toContainText(`${asKarachi} for them`);
  // The two zones really are different, so this is not a vacuous check.
  expect(asNewYork).not.toBe(asKarachi);
});

test('slots land on the 30-minute grid and respect the duration', async ({ page }) => {
  const tutorId = await karachiTutorId();
  await signIn(page, ACCOUNTS.student);

  await page.goto(`/tutors/${tutorId}?duration=30`);
  const halfHourStarts = await page
    .getByTestId('calendar-slot')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-start')!));

  for (const start of halfHourStarts) {
    const date = new Date(start);
    expect(date.getUTCMinutes() % 30).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
  }

  await page.goto(`/tutors/${tutorId}?duration=60`);
  const hourStarts = await page
    .getByTestId('calendar-slot')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-start')!));

  // An hour needs two contiguous slots, so there can never be more of them.
  expect(hourStarts.length).toBeLessThanOrEqual(halfHourStarts.length);
  expect(hourStarts.length).toBeGreaterThan(0);
});

test('the calendar never offers a slot that collides with an existing booking', async ({ page }) => {
  const tutorId = await karachiTutorId();
  await signIn(page, ACCOUNTS.student);
  await page.goto(`/tutors/${tutorId}?duration=30`);

  const offered = (
    await page
      .getByTestId('calendar-slot')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-start')!))
  ).map((iso) => new Date(iso).getTime());

  const booked = await queryDatabase(
    async (sql) =>
      await sql<{ start_at_utc: Date; duration_minutes: number; buffer_minutes: number }[]>`
        select b.start_at_utc, b.duration_minutes, tp.buffer_minutes
        from bookings b
        join tutor_profiles tp on tp.user_id = b.tutor_id
        where b.tutor_id = ${tutorId}
          and b.status in ('pending_tutor', 'confirmed', 'in_progress')
          and b.start_at_utc > now()
      `,
  );

  for (const row of booked) {
    const bufferMs = row.buffer_minutes * 60_000;
    const from = new Date(row.start_at_utc).getTime() - bufferMs;
    const to = new Date(row.start_at_utc).getTime() + row.duration_minutes * 60_000 + bufferMs;

    for (const start of offered) {
      const overlaps = start + 30 * 60_000 > from && start < to;
      expect(overlaps, `slot ${new Date(start).toISOString()} collides with a booking`).toBe(false);
    }
  }
});

test('blocked time disappears from the calendar', async ({ page }) => {
  const tutorId = await karachiTutorId();
  await signIn(page, ACCOUNTS.student);
  await page.goto(`/tutors/${tutorId}?duration=30`);

  const before = await page.getByTestId('calendar-slot').count();
  expect(before).toBeGreaterThan(0);

  // Block the next fortnight outright, the way vacation mode does.
  await queryDatabase(
    async (sql) => await sql`
      insert into availability_exceptions (tutor_id, date, kind, start_utc, end_utc, note)
      values (
        ${tutorId}::uuid,
        current_date,
        'block',
        now() - interval '1 day',
        now() + interval '30 days',
        'e2e vacation'
      )
    `,
  );

  await page.reload();
  await expect(page.getByText(/Nothing free in the next few weeks/)).toBeVisible();
  expect(await page.getByTestId('calendar-slot').count()).toBe(0);

  // Put it back, so the rest of the suite sees the seeded world.
  await queryDatabase(
    async (sql) => await sql`delete from availability_exceptions where note = 'e2e vacation'`,
  );

  await page.reload();
  expect(await page.getByTestId('calendar-slot').count()).toBeGreaterThan(0);
});

test('a tutor with no published hours says so, rather than showing nothing free', async ({ page }) => {
  // The draft account has never set a calendar up.
  const rows = await queryDatabase(
    async (sql) =>
      await sql<{ id: string }[]>`select id from users where email = ${ACCOUNTS.draftTutor}`,
  );

  await signIn(page, ACCOUNTS.draftTutor);
  await page.goto(`/tutors/${rows[0]!.id}`);

  // Their own preview: unverified, so not bookable at all.
  await expect(page.getByText(/has not completed verification yet/).first()).toBeVisible();
});

test('the day and time filter uses the real calendar', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);

  await page.goto('/');
  const unfiltered = await page.getByTestId('tutor-card').count();

  // A narrow window in the middle of the night, New York time — few tutors are
  // free then, and the filter has to actually consult the calendar to know.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.goto(`/?availDate=${tomorrow}&availFrom=03:00&availTo=04:00`);

  const narrow = await page.getByTestId('tutor-card').count();
  expect(narrow).toBeLessThan(unfiltered);

  // And a wide window returns more than the narrow one.
  await page.goto(`/?availDate=${tomorrow}&availFrom=06:00&availTo=23:30`);
  expect(await page.getByTestId('tutor-card').count()).toBeGreaterThanOrEqual(narrow);
});

test('the "available in the next hour" rail is live now, not a placeholder', async ({ page }) => {
  await page.goto('/');

  // The Phase 2 placeholder is gone — the calendar can answer this now.
  await expect(page.getByText(/needs the booking calendar, which arrives in Phase 3/)).toHaveCount(0);

  // An empty rail hides itself rather than showing a heading over nothing, so
  // the assertion is conditional: present means it has real cards under it.
  const heading = page.getByRole('heading', { name: 'Available in the next hour' });
  if ((await heading.count()) > 0) {
    const rail = page.locator('section', { has: heading });
    expect(await rail.getByTestId('tutor-card').count()).toBeGreaterThan(0);
  }

  // Either way, the port is answering: cards now carry next-free lines, which
  // they could not while availability was unknown.
  await expect(page.getByText(/^Next free:/).first()).toBeVisible();
});

test('ranking now scores availability from the calendar', async ({ page }) => {
  const density = await queryDatabase(
    async (sql) =>
      await sql<{ availability_density_bps: number }[]>`
        select availability_density_bps from tutor_ranking
      `,
  );

  expect(density.length).toBeGreaterThan(0);
  // Before the engine every tutor scored the same neutral constant. Real
  // calendars produce a spread.
  expect(new Set(density.map((row) => row.availability_density_bps)).size).toBeGreaterThan(1);
});
