/**
 * Phase 2's acceptance criteria, through the real UI.
 *
 * The feed renders the seeded tutors with working autoplay, rails and filters,
 * and the ordering comes from `tutor_ranking` rather than from anything
 * computed while the page was being built.
 */

import { expect, test } from '@playwright/test';

import { ACCOUNTS, queryDatabase, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

test('the feed renders seeded tutors as cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find a tutor worth your hour' })).toBeVisible();

  const cards = page.getByTestId('tutor-card');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(10);

  // Cards carry a poster and a preview produced by the video pipeline.
  const grid = page.locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) });
  const firstCard = grid.getByTestId('tutor-card').first();
  await expect(firstCard.locator('img').first()).toHaveAttribute('src', /thumb-\d\.jpg$/);
  await expect(firstCard.locator('video')).toHaveAttribute('src', /preview\.mp4$/);
});

/**
 * Autoplay.
 *
 * The preview is H.264/AAC in an MP4, which every real browser plays. The
 * open-source Chromium that Playwright ships deliberately excludes proprietary
 * codecs — it reports `canPlayType('video/mp4; codecs="avc1..."')` as empty and
 * fails to demux — so asserting that pixels move here would be testing
 * Chromium's build flags, not our code.
 *
 * These tests instead assert the behaviour that is ours: that hovering calls
 * play on the right element, that it is muted first, that leaving rewinds it,
 * and that it stops itself after the eight seconds SPEC.md §4 asks for.
 */
async function spyOnPlayback(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: { type: 'play' | 'pause'; at: number; muted: boolean; src: string }[] = [];
    (window as unknown as { __playback: typeof calls }).__playback = calls;

    const play = HTMLMediaElement.prototype.play;
    const pause = HTMLMediaElement.prototype.pause;

    HTMLMediaElement.prototype.play = function playSpy(this: HTMLMediaElement) {
      calls.push({ type: 'play', at: Date.now(), muted: this.muted, src: this.currentSrc || this.src });
      return play.call(this);
    };
    HTMLMediaElement.prototype.pause = function pauseSpy(this: HTMLMediaElement) {
      calls.push({ type: 'pause', at: Date.now(), muted: this.muted, src: this.currentSrc || this.src });
      return pause.call(this);
    };
  });
}

type PlaybackCall = { type: 'play' | 'pause'; at: number; muted: boolean; src: string };

function playback(page: import('@playwright/test').Page): Promise<PlaybackCall[]> {
  return page.evaluate(() => (window as unknown as { __playback: PlaybackCall[] }).__playback ?? []);
}

test('hovering a card autoplays its preview, muted', async ({ page }) => {
  await spyOnPlayback(page);
  await page.goto('/');

  const card = page
    .locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) })
    .getByTestId('tutor-card')
    .first();

  expect(await playback(page)).toEqual([]);

  await card.locator('div').first().hover();

  await expect.poll(async () => (await playback(page)).filter((call) => call.type === 'play').length).toBe(1);

  const [play] = (await playback(page)).filter((call) => call.type === 'play');
  expect(play!.muted).toBe(true);
  expect(play!.src).toMatch(/preview\.mp4$/);
});

test('moving away stops the preview and rewinds it', async ({ page }) => {
  await spyOnPlayback(page);
  await page.goto('/');

  const card = page
    .locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) })
    .getByTestId('tutor-card')
    .first();

  await card.locator('div').first().hover();
  await expect.poll(async () => (await playback(page)).length).toBeGreaterThan(0);

  await page.getByRole('heading', { name: 'Find a tutor worth your hour' }).hover();

  await expect.poll(async () => (await playback(page)).some((call) => call.type === 'pause')).toBe(true);
  await expect(card.locator('video')).toHaveJSProperty('currentTime', 0);
});

test('the preview stops itself after eight seconds', async ({ page }) => {
  await spyOnPlayback(page);
  await page.goto('/');

  const card = page
    .locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) })
    .getByTestId('tutor-card')
    .first();

  const container = card.locator('div').first();
  await container.hover();
  await expect.poll(async () => (await playback(page)).length).toBeGreaterThan(0);

  // Keep the pointer where it is, so any pause comes from the timer.
  await expect
    .poll(async () => (await playback(page)).some((call) => call.type === 'pause'), { timeout: 12_000 })
    .toBe(true);

  const calls = await playback(page);
  const started = calls.find((call) => call.type === 'play')!;
  const stopped = calls.find((call) => call.type === 'pause')!;
  const elapsed = stopped.at - started.at;

  // SPEC.md §4 says eight seconds; allow for scheduling slop either side.
  expect(elapsed).toBeGreaterThan(7_000);
  expect(elapsed).toBeLessThan(11_000);
});

test('the home rails are present', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Free trials' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New tutors' })).toBeVisible();

  // "Available in the next hour" and the availability-dependent badges are
  // covered by e2e/availability.spec.ts, which owns them now that the calendar
  // is real. Until Checkpoint A they were placeholders asserted here.
  await expect(page.getByText(/arrives in Phase 3/)).toHaveCount(0);
});

test('"Continue with your tutors" is built from real session history', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Continue with your tutors' })).toHaveCount(0);

  await signIn(page, ACCOUNTS.student);
  await page.goto('/');

  const rail = page.getByRole('heading', { name: 'Continue with your tutors' });
  await expect(rail).toBeVisible();

  // Every tutor in the rail is one this student has actually paid for a session
  // with, so opening one and coming back is a rebook, not a discovery.
  const railSection = page.locator('section', { has: rail });
  expect(await railSection.getByTestId('tutor-card').count()).toBeGreaterThan(0);
});

test('category chips filter the feed and drive the top-rated rail', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Subjects' }).getByRole('link', { name: 'Math' }).click();

  await expect(page).toHaveURL(/subject=math/);
  await expect(page.getByRole('link', { name: 'Math', exact: true })).toHaveAttribute('aria-current', 'page');

  // Browsing a category is remembered, and the rail appears back on the feed.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Top rated in Math' })).toBeVisible();
});

test('search and filters narrow the results', async ({ page }) => {
  await page.goto('/');
  const all = await page.getByTestId('tutor-card').count();

  await page.getByLabel('Search tutors').fill('Physics');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=Physics/);

  const searched = await page.getByTestId('tutor-card').count();
  expect(searched).toBeGreaterThan(0);
  expect(searched).toBeLessThan(all);

  // A search is a plain result list — the rails step out of the way.
  await expect(page.getByRole('heading', { name: 'Free trials' })).toHaveCount(0);
});

test('the price filter uses the price a student would actually pay', async ({ page }) => {
  await page.goto('/?maxPrice=15&sort=price_asc');

  const prices = await page
    .locator('section', { has: page.getByRole('heading', { name: /result/ }) })
    .getByTestId('tutor-card')
    .getByTestId('card-price')
    .allInnerTexts();

  expect(prices.length).toBeGreaterThan(0);

  const numbers = prices.map((text) => {
    // A promoted tutor shows the old price struck through, then the real one.
    const matches = [...text.matchAll(/\$([\d,]+\.\d{2})/g)].map((match) => Number(match[1]!.replace(',', '')));
    return matches[matches.length - 1]!;
  });

  for (const price of numbers) expect(price).toBeLessThanOrEqual(15);
  // And price ascending really is ascending.
  expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
});

test('sorting by rating reorders the feed', async ({ page }) => {
  await page.goto('/?sort=relevance');
  const byRelevance = await page.getByTestId('tutor-card').locator('h3').allInnerTexts();

  await page.goto('/?sort=rating');
  const byRating = await page.getByTestId('tutor-card').locator('h3').allInnerTexts();

  expect(byRating).not.toEqual(byRelevance);
});

test('the feed order comes from the ranking table, not from the request', async ({ page }) => {
  // A first visit, with no session and no timezone cookie yet. We do not know
  // where this visitor is, so the timezone-overlap term stays out of the
  // ordering rather than assuming UTC — which makes this the plain nightly
  // score, exactly as the table holds it. (The overlap term is exercised in
  // `curriculum.spec.ts`, where the viewer's timezone is actually known.)
  await page.goto('/');
  const shown = (
    await page
      .locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) })
      .getByTestId('tutor-card')
      .locator('h3')
      .allInnerTexts()
  ).map((name) => name.replace('✓', '').trim());

  expect(shown.length).toBeGreaterThan(5);

  const ranked = await queryDatabase(async (sql) => {
    const rows = await sql<{ name: string; score: number }[]>`
      select users.name, tutor_ranking.score
      from tutor_profiles
      join users on users.id = tutor_profiles.user_id
      left join tutor_ranking on tutor_ranking.tutor_id = tutor_profiles.user_id
      where tutor_profiles.status = 'verified' and users.suspended_at is null
      order by tutor_ranking.score desc nulls last, users.name asc
    `;
    return rows;
  });

  // The page is exactly the first screenful of the table's own ordering.
  expect(shown).toEqual(ranked.slice(0, shown.length).map((row) => row.name));

  // And the table really is scored, not all zeroes.
  expect(new Set(ranked.map((row) => row.score)).size).toBeGreaterThan(1);
});

test('a tutor profile leads with the intro video and shows qualifications without documents', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) })
    .getByTestId('tutor-card')
    .first()
    .locator('a')
    .first()
    .click();

  await expect(page).toHaveURL(/\/tutors\/[0-9a-f-]{36}$/);

  // Video hero, with a poster and a play control rather than an autoplaying clip.
  const hero = page.getByRole('button', { name: /Play .*intro video/ });
  await expect(hero).toBeVisible();
  await expect(page.locator('video[poster]')).toBeVisible();

  // Qualifications name the institution and the year, and never link a document.
  const qualifications = page.locator('div', { has: page.getByRole('heading', { name: 'Qualifications' }) });
  await expect(qualifications.getByText(/never the document itself/)).toBeVisible();
  await expect(page.locator('a[href*="/api/files/"]')).toHaveCount(0);
});
