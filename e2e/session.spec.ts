/**
 * The classroom, end to end (SPEC.md §7).
 *
 * This suite drives two real browsers into a real LiveKit room and then settles
 * the booking from the webhooks that call produced. It exists because the parts
 * that decide money — who was in the room, for how long, and what that is worth
 * — cannot be proven by unit tests alone: the seconds come from LiveKit, not
 * from anything this codebase can assert about itself.
 *
 * It needs a LiveKit server. `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
 * `LIVEKIT_API_SECRET` in `.env` point at one; without them the call tests skip
 * rather than fail, because a missing dev dependency is not a broken product.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, test, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';

import {
  ACCOUNTS,
  MOBILE_3G,
  OFFLINE,
  PHONE_WIDTH,
  expectNoSidewaysScroll,
  launchCallBrowser,
  liveKitEvent,
  postLiveKitWebhook,
  queryDatabase,
  signIn,
  throttle,
} from './helpers';

const run = promisify(execFile);

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** The one row a query was supposed to return, with a message when it is not there. */
function only<T>(rows: T[], what: string): T {
  expect(rows, what).toHaveLength(1);
  return rows[0]!;
}
const LIVEKIT_READY = Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

type SeededBooking = {
  id: string;
  start_at_utc: Date;
  duration_minutes: number;
  price_cents: number;
  commission_bps: number;
  student_id: string;
  tutor_id: string;
  livekit_room: string;
};

/** The booking the seed leaves running right now, so the room is open. */
async function liveBooking(): Promise<SeededBooking> {
  const rows = await queryDatabase<SeededBooking[]>(
    (sql) => sql`
      select b.id, b.start_at_utc, b.duration_minutes, b.price_cents, b.commission_bps,
             b.student_id, b.tutor_id, b.livekit_room
      from bookings b
      join users s on s.id = b.student_id
      join users t on t.id = b.tutor_id
      where s.email = ${ACCOUNTS.student}
        and t.email = ${ACCOUNTS.verifiedTutor}
        and b.status in ('confirmed', 'in_progress')
        and b.start_at_utc <= now()
        and b.start_at_utc + make_interval(mins => b.duration_minutes) > now()
      order by b.start_at_utc desc
      limit 1
    ` as never,
  );

  return only(rows, 'the seed should leave one session running right now');
}

/** The booking the seed leaves finished and unsettled, a day and a bit ago. */
async function settleableBooking(): Promise<SeededBooking> {
  const rows = await queryDatabase<SeededBooking[]>(
    (sql) => sql`
      select b.id, b.start_at_utc, b.duration_minutes, b.price_cents, b.commission_bps,
             b.student_id, b.tutor_id, b.livekit_room
      from bookings b
      join users s on s.id = b.student_id
      join users t on t.id = b.tutor_id
      where s.email = ${ACCOUNTS.student}
        and t.email = ${ACCOUNTS.verifiedTutor}
        and b.settled_at is null
        and b.start_at_utc + make_interval(mins => b.duration_minutes) < now() - interval '24 hours'
      order by b.start_at_utc desc
      limit 1
    ` as never,
  );

  return only(rows, 'the seed should leave one session waiting to settle');
}

/**
 * Every cent this booking has moved, by account.
 *
 * Scoped to the booking rather than to the person: the seed gives the two demo
 * accounts more than one booking, and a balance read by owner would fold in the
 * other one's settlement.
 */
async function balances(booking: SeededBooking) {
  const rows = await queryDatabase<{ credits: number; escrow: number; available: number; platform: number }[]>(
    (sql) => sql`
      select
        (select coalesce(sum(delta_cents), 0) from ledger_entries
          where account = 'student_credits' and booking_id = ${booking.id})::int as credits,
        (select coalesce(sum(delta_cents), 0) from ledger_entries
          where account = 'escrow' and booking_id = ${booking.id})::int as escrow,
        (select coalesce(sum(delta_cents), 0) from ledger_entries
          where account = 'tutor_available' and booking_id = ${booking.id})::int as available,
        (select coalesce(sum(delta_cents), 0) from ledger_entries
          where account = 'platform_revenue' and booking_id = ${booking.id})::int as platform
    ` as never,
  );
  return only(rows, 'one row of balances');
}

async function eventsFor(bookingId: string) {
  return queryDatabase<{ event: string; user_id: string | null; at_utc: Date }[]>(
    (sql) => sql`
      select event, user_id, at_utc from session_events
      where booking_id = ${bookingId} order by at_utc asc, id asc
    ` as never,
  );
}

/** Signs in, opens the classroom, and gets through the pre-call check. */
async function enterClassroom(
  browser: Browser,
  email: string,
  bookingId: string,
): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.grantPermissions(['camera', 'microphone'], { origin: BASE_URL });

  const page = await context.newPage();
  await signIn(page, email);
  await page.goto(`/sessions/${bookingId}`);
  await expect(page.getByRole('heading', { name: 'Check your setup' })).toBeVisible();

  // The throttling goes on before the check, so the check measures the same
  // link the call will run over.
  const cdp = await throttle(page, MOBILE_3G);

  await page.getByRole('button', { name: 'Run the check' }).click();
  await expect(page.getByRole('button', { name: /^Join (the session|with voice only)$/ })).toBeEnabled({
    timeout: 30_000,
  });

  return { context, page, cdp };
}

async function joinRoom(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Join (the session|with voice only)$/ }).click();
  await expect(page.getByTestId('session-clock')).toBeVisible({ timeout: 45_000 });
}

/** "48:12" as seconds, so the clock can be compared across a reconnect. */
function clockSeconds(text: string): number {
  const match = /^(-?)(\d+):(\d+)$/.exec(text.trim());
  expect(match, `unexpected clock format: ${text}`).toBeTruthy();
  const [, sign, minutes, seconds] = match!;
  return (sign === '-' ? -1 : 1) * (Number(minutes) * 60 + Number(seconds));
}

// ---------------------------------------------------------------------------

test.describe('the classroom', () => {
  test.skip(!LIVEKIT_READY, 'LiveKit is not configured for this run');
  test.describe.configure({ mode: 'serial' });

  test('two browsers hold a call over a throttled link, and one survives losing the network', async () => {
    test.setTimeout(180_000);

    const booking = await liveBooking();

    const studentBrowser = await launchCallBrowser();
    const tutorBrowser = await launchCallBrowser();

    try {
      const student = await enterClassroom(studentBrowser, ACCOUNTS.student, booking.id);
      const tutor = await enterClassroom(tutorBrowser, ACCOUNTS.verifiedTutor, booking.id);

      await joinRoom(student.page);
      await joinRoom(tutor.page);

      // Each side can see the other. This is the actual call working: media is
      // being published and subscribed across two independent browsers.
      await expect(student.page.getByText(/is here$/)).toBeVisible({ timeout: 45_000 });
      await expect(tutor.page.getByText(/is here$/)).toBeVisible({ timeout: 45_000 });

      // A lesson is taken on a phone as often as not, so the live classroom has
      // to fit one — with the call actually running, not just the setup screen.
      await student.page.setViewportSize({ width: PHONE_WIDTH, height: 740 });
      await expectNoSidewaysScroll(student.page, 'the live classroom');
      await expect(student.page.getByTestId('end-session')).toBeVisible();
      await student.page.setViewportSize({ width: 1280, height: 720 });

      const before = clockSeconds(await student.page.getByTestId('session-clock').innerText());

      // The student's phone loses the network mid-lesson.
      await throttle(student.page, OFFLINE, student.cdp);

      await expect(student.page.getByTestId('reconnecting')).toBeVisible({ timeout: 60_000 });
      await expect(student.page.getByText('the session clock is still running')).toBeVisible();

      // ...and gets it back.
      await throttle(student.page, MOBILE_3G, student.cdp);

      await expect(student.page.getByTestId('reconnecting')).toBeHidden({ timeout: 60_000 });
      await expect(student.page.getByTestId('session-clock')).toBeVisible();

      // The clock is server truth, so it kept running while they were away
      // rather than restarting from the booked duration.
      const after = clockSeconds(await student.page.getByTestId('session-clock').innerText());
      expect(after, 'the clock must not rewind across a reconnect').toBeLessThan(before);

      // Both leave deliberately.
      await student.page.getByTestId('end-session').click();
      await expect(student.page.getByRole('heading', { name: 'Session ended' })).toBeVisible();

      await tutor.page.getByTestId('end-session').click();
      await expect(tutor.page.getByRole('heading', { name: 'Session ended' })).toBeVisible();

      await student.context.close();
      await tutor.context.close();

      // LiveKit's webhooks are what the money is decided from. They arrive out
      // of band, so give them a moment to land.
      await expect
        .poll(async () => (await eventsFor(booking.id)).filter((row) => row.event === 'participant_left').length, {
          timeout: 30_000,
        })
        .toBeGreaterThanOrEqual(2);

      const events = await eventsFor(booking.id);
      const joinedIds = events.filter((row) => row.event === 'participant_joined').map((row) => row.user_id);

      expect(joinedIds).toContain(booking.student_id);
      expect(joinedIds).toContain(booking.tutor_id);

      // The booking moved itself along when somebody actually arrived.
      const live = only(
        await queryDatabase<{ status: string }[]>(
          (sql) => sql`select status from bookings where id = ${booking.id}` as never,
        ),
        'the booking still exists',
      );
      expect(live.status).toBe('in_progress');
    } finally {
      await studentBrowser.close();
      await tutorBrowser.close();
    }
  });

  test('a full hour of attendance arrives as signed webhooks, and a redelivery counts once', async () => {
    const booking = await settleableBooking();
    const start = booking.start_at_utc;
    const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

    // What a lesson on a Karachi mobile connection actually looks like: the
    // tutor arrives early, the student drops out for two minutes in the middle
    // and comes back, and both leave at the end.
    const script = [
      liveKitEvent({ event: 'room_started', roomName: booking.livekit_room, at: at(-1) }),
      liveKitEvent({ event: 'participant_joined', roomName: booking.livekit_room, at: at(-1), identity: booking.tutor_id }),
      liveKitEvent({ event: 'participant_joined', roomName: booking.livekit_room, at: at(0.5), identity: booking.student_id }),
      liveKitEvent({ event: 'participant_left', roomName: booking.livekit_room, at: at(20), identity: booking.student_id }),
      liveKitEvent({ event: 'participant_joined', roomName: booking.livekit_room, at: at(22), identity: booking.student_id }),
      liveKitEvent({ event: 'participant_left', roomName: booking.livekit_room, at: at(59), identity: booking.student_id }),
      liveKitEvent({ event: 'participant_left', roomName: booking.livekit_room, at: at(60), identity: booking.tutor_id }),
      liveKitEvent({ event: 'room_finished', roomName: booking.livekit_room, at: at(60) }),
    ];

    for (const event of script) {
      const response = await postLiveKitWebhook(BASE_URL, event);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ recorded: true });
    }

    // A redelivery must not count twice — LiveKit retries, and a duplicated
    // join would inflate what the tutor is paid.
    for (const event of script) {
      const response = await postLiveKitWebhook(BASE_URL, event);
      expect(await response.json()).toMatchObject({ recorded: false });
    }

    expect(await eventsFor(booking.id)).toHaveLength(script.length);
  });

  test('an unsigned webhook is refused', async () => {
    const booking = await settleableBooking();

    const response = await fetch(`${BASE_URL}/api/livekit/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/webhook+json' },
      body: JSON.stringify(
        liveKitEvent({
          event: 'participant_joined',
          roomName: booking.livekit_room,
          at: new Date(),
          identity: booking.tutor_id,
        }),
      ),
    });

    expect(response.status).toBe(401);
  });

  test('a day later, both sessions settle to the right cents', async () => {
    const live = await liveBooking();
    const attended = await settleableBooking();

    const liveBefore = await balances(live);
    const attendedBefore = await balances(attended);

    // One run of the nightly job, at a moment past both dispute windows.
    const settleAt = new Date(
      live.start_at_utc.getTime() + (live.duration_minutes + 24 * 60 + 1) * 60_000,
    );

    const { stdout } = await run('pnpm', ['settle', '--at', settleAt.toISOString()], {
      cwd: process.cwd(),
      timeout: 120_000,
    });

    expect(stdout).toContain('2 of 2 settled');
    expect(stdout).toContain('technical_failure');
    expect(stdout).toContain('completed');

    // The real call: two browsers in the room for seconds, not for half of a
    // booked hour. Nobody is charged for a lesson that did not happen.
    const liveRow = only(
      await queryDatabase<{ status: string; settled_at: Date | null }[]>(
        (sql) => sql`select status, settled_at from bookings where id = ${live.id}` as never,
      ),
      'the live booking still exists',
    );
    expect(liveRow.status).toBe('refunded');
    expect(liveRow.settled_at).not.toBeNull();

    const liveAfter = await balances(live);
    expect(liveAfter.credits - liveBefore.credits).toBe(live.price_cents);
    expect(liveAfter.escrow).toBe(0);
    expect(liveAfter.available - liveBefore.available).toBe(0);
    expect(liveAfter.platform).toBe(0);

    // The attended hour: no refund, the tutor keeps their share, the platform
    // takes the commission that was snapshotted onto the booking.
    const platformCents = Math.floor((attended.price_cents * attended.commission_bps) / 10_000);
    const tutorCents = attended.price_cents - platformCents;

    const attendedAfter = await balances(attended);
    expect(attendedAfter.credits - attendedBefore.credits).toBe(0);
    expect(attendedAfter.escrow).toBe(0);
    expect(attendedAfter.available - attendedBefore.available).toBe(tutorCents);
    expect(attendedAfter.platform).toBe(platformCents);

    const attendedRow = only(
      await queryDatabase<{ status: string }[]>(
        (sql) => sql`select status from bookings where id = ${attended.id}` as never,
      ),
      'the attended booking still exists',
    );
    expect(attendedRow.status).toBe('settled');

    // Running it again is a no-op: the idempotency keys reject the replay.
    const second = await run('pnpm', ['settle', '--at', settleAt.toISOString()], {
      cwd: process.cwd(),
      timeout: 120_000,
    });
    expect(second.stdout).toContain('nothing past its dispute window');

    expect(await balances(live)).toEqual(liveAfter);
    expect(await balances(attended)).toEqual(attendedAfter);
  });

  test('nothing is left owing, and every materialised balance matches the ledger', async () => {
    const outstanding = await queryDatabase<{ id: string }[]>(
      (sql) => sql`
        select id from bookings
        where settled_at is null
          and start_at_utc + make_interval(mins => duration_minutes) < now() - interval '24 hours'
          and status in ('confirmed', 'in_progress', 'completed', 'no_show_student', 'no_show_tutor')
      ` as never,
    );
    expect(outstanding, 'everything past its dispute window should have settled').toHaveLength(0);

    // The nightly reconciler: every materialised column equals the sum of the
    // ledger rows behind it. If settlement moved a cent it should not have,
    // this is where it shows up.
    const { stdout } = await run('pnpm', ['reconcile'], { cwd: process.cwd(), timeout: 120_000 });
    expect(stdout).toContain('zero drift');
  });
});
