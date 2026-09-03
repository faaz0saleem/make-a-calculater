/**
 * Phase 1's acceptance criteria, driven through the real UI.
 *
 *   1. A seeded draft tutor is invisible in search and cannot be booked.
 *   2. They walk the whole wizard, and it resumes where they left off.
 *   3. They submit; an admin sees the documents and approves.
 *   4. They now appear in the feed and in search, and their profile is public.
 *
 * Run with `pnpm e2e`, which reseeds first.
 */

import { expect, test } from '@playwright/test';

import { ACCOUNTS, introVideoBytes, pdfBytes, pngBytes, signIn, signOut } from './helpers';

const NEW_TUTOR_NAME = 'Amara Nwosu';
const BIO = `I have taught secondary and university mathematics for eleven years, mostly to students who had decided they were "bad at maths" long before they met me. We work from your syllabus and your past papers rather than a generic curriculum, and every session ends with a short written summary and a handful of practice problems you keep. Book the free trial first — I would rather you found the right tutor than the first one.`;

/** Discovered in the first test and reused; the seed gives it a fresh uuid each run. */
let tutorId = '';

test.describe.configure({ mode: 'serial' });

test('a draft tutor is invisible in the feed and in search', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find a tutor worth your hour' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(NEW_TUTOR_NAME) })).toHaveCount(0);

  await page.goto(`/?q=${encodeURIComponent(NEW_TUTOR_NAME)}`);
  await expect(page.getByText('No matches')).toBeVisible();
});

test('the draft tutor can preview their own profile, and nobody else can', async ({ page }) => {
  await signIn(page, ACCOUNTS.draftTutor);
  await page.goto('/tutor');

  const preview = page.getByRole('link', { name: 'Preview public profile' });
  await expect(preview).toBeVisible();

  const href = await preview.getAttribute('href');
  tutorId = href!.replace('/tutors/', '');
  expect(tutorId).toMatch(/^[0-9a-f-]{36}$/);

  // The tutor sees their own unpublished profile, clearly marked.
  await page.goto(`/tutors/${tutorId}`);
  await expect(page.getByText(/Preview — this profile is/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Book/ })).toBeDisabled();

  // A student gets a 404, not a 403: the account's existence is not confirmed.
  await signOut(page);
  await signIn(page, ACCOUNTS.student);
  const response = await page.goto(`/tutors/${tutorId}`);
  expect(response?.status()).toBe(404);

  // And so does a signed-out visitor.
  await signOut(page);
  const anonymous = await page.goto(`/tutors/${tutorId}`);
  expect(anonymous?.status()).toBe(404);
});

test('the tutor walks the whole wizard and it saves at every step', async ({ page }) => {
  await signIn(page, ACCOUNTS.draftTutor);

  // Resume sends them to the first unfinished step.
  await page.goto('/tutor/onboarding');
  await expect(page).toHaveURL(/\/tutor\/onboarding\/identity$/);

  // ---- Step 2: identity -------------------------------------------------
  await page.getByLabel('Full name').fill(NEW_TUTOR_NAME);
  await page.getByLabel('Country').fill('NG');
  await page.getByLabel('City').fill('Lagos');
  await page.getByLabel('Timezone').selectOption('Africa/Lagos');
  await page.locator('select[name="language:en"]').selectOption('native');
  await page.locator('select[name="language:fr"]').selectOption('conversational');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/profile\?saved=1$/);

  // Leaving and coming back resumes here, with identity marked done.
  await page.goto('/tutor/onboarding');
  await expect(page).toHaveURL(/\/tutor\/onboarding\/profile$/);

  // ---- Step 3: profile --------------------------------------------------
  await page.getByLabel('Headline').fill('Maths that finally makes sense');
  await page.getByLabel('Bio').fill(BIO);
  await page.getByLabel('Profile photo').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: pngBytes(),
  });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/video\?saved=1$/);

  // ---- Step 4: intro video ---------------------------------------------
  // A real clip: the pipeline probes it, enforces the 30-90 second rule, and
  // transcodes it to HLS with three thumbnail candidates.
  await page.getByLabel('Intro video').setInputFiles({
    name: 'intro.mp4',
    mimeType: 'video/mp4',
    buffer: await introVideoBytes(35),
  });
  await page.getByRole('button', { name: 'Upload video' }).click();

  // Three candidates to pick from, one of them already chosen.
  const thumbnails = page.getByRole('radio');
  await expect(thumbnails).toHaveCount(3, { timeout: 90_000 });
  await expect(page.getByText('35 seconds.')).toBeVisible();

  // Pick a different one and save it. The radio itself is visually hidden, so
  // click the thumbnail the way a person would.
  await page.locator('label:has(input[name="thumbnailUrl"])').first().click();
  await expect(thumbnails.first()).toBeChecked();

  await page.getByRole('button', { name: 'Use this thumbnail' }).click();
  await expect(page).toHaveURL(/\/video\?saved=1$/);
  await expect(thumbnails.first()).toBeChecked();

  await page.goto('/tutor/onboarding/subjects');

  // ---- Step 5: subjects -------------------------------------------------
  await page.getByRole('checkbox', { name: 'Math' }).check();
  await page.getByRole('checkbox', { name: 'Physics' }).check();
  await page.getByLabel('Years teaching Math').fill('11');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/credentials\?saved=1$/);

  // ---- Step 6: credentials ---------------------------------------------
  await page.getByLabel('Type').selectOption('degree');
  await page.getByLabel('Title').fill('BSc Mathematics');
  await page.getByLabel('Institution').fill('University of Lagos');
  await page.getByLabel('Year').fill('2013');
  await page.getByLabel('File').setInputFiles({
    name: 'degree.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBytes('BSc Mathematics - University of Lagos - 2013'),
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByText('BSc Mathematics')).toBeVisible();

  // ---- Step 7: rates ----------------------------------------------------
  await page.goto('/tutor/onboarding/rates');
  await page.getByLabel('60-minute rate').fill('30.00');
  await page.getByLabel('30-minute rate').fill('17.00');
  await page.getByLabel('Offer a free trial').check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/availability\?saved=1$/);

  // ---- Step 8: availability --------------------------------------------
  await page.getByLabel('Monday start').fill('17:00');
  await page.getByLabel('Monday end').fill('21:00');
  await page.getByLabel('Wednesday start').fill('17:00');
  await page.getByLabel('Wednesday end').fill('21:00');
  await page.getByLabel('Saturday start').fill('09:00');
  await page.getByLabel('Saturday end').fill('15:00');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/payout\?saved=1$/);

  // ---- Step 9: payout is optional --------------------------------------
  await page.getByRole('link', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/review$/);

  // ---- Step 10: submit --------------------------------------------------
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page).toHaveURL(/\/tutor\?submitted=1$/);
  await expect(page.getByText('pending_review')).toBeVisible();
});

test('an admin reads the documents and approves', async ({ page }) => {
  await signIn(page, ACCOUNTS.admin);

  await page.goto('/admin/verification');
  const row = page.locator('li', { hasText: ACCOUNTS.draftTutor });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Review' }).click();

  await expect(page.getByRole('heading', { name: NEW_TUTOR_NAME })).toBeVisible();
  await expect(page.getByText('Maths that finally makes sense')).toBeVisible();
  await expect(page.getByText('University of Lagos')).toBeVisible();

  // The document link is signed and short-lived.
  const documentUrl = await page.locator('object[type="application/pdf"]').first().getAttribute('data');
  expect(documentUrl).toMatch(/^\/api\/files\/credentials\//);
  expect(documentUrl).toMatch(/[?&]sig=/);
  expect(documentUrl).toMatch(/[?&]exp=/);

  // Stripping the signature makes it useless.
  const unsigned = await page.request.get(documentUrl!.split('?')[0]!);
  expect(unsigned.status()).toBe(403);

  // With the signature, an admin gets the file.
  const signed = await page.request.get(documentUrl!);
  expect(signed.status()).toBe(200);
  expect(signed.headers()['content-type']).toContain('application/pdf');

  // Approving needs the whole checklist.
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  // Next renders its own role="alert" route announcer, so target the message.
  await expect(page.getByText('Tick every checklist item')).toBeVisible();

  for (const label of [
    'The name on the document matches the profile',
    'The institution exists and is plausible',
    'The document is legible',
    'The document has not expired',
  ]) {
    await page.getByRole('checkbox', { name: label }).check();
  }
  await page.getByRole('button', { name: 'Approve and publish' }).click();

  await expect(page).toHaveURL(/\/admin\/verification\?decided=approved$/);
  await expect(page.getByText('Tutor verified')).toBeVisible();
  await expect(page.locator('li', { hasText: ACCOUNTS.draftTutor })).toHaveCount(0);
});

test('the verified tutor is now in the feed, in search, and publicly visible', async ({ page }) => {
  // Scoped to the ranked grid: a newly verified tutor who offers a trial also
  // turns up in the rails, and an unscoped locator would match twice.
  const grid = () => page.locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) });

  await page.goto('/');
  await expect(grid().getByRole('link', { name: new RegExp(NEW_TUTOR_NAME) })).toBeVisible();

  await page.goto(`/?q=${encodeURIComponent('Amara')}`);
  await expect(page.getByRole('link', { name: new RegExp(NEW_TUTOR_NAME) })).toBeVisible();

  // Searching by subject finds them too.
  await page.goto('/?q=Physics');
  await expect(page.getByRole('link', { name: new RegExp(NEW_TUTOR_NAME) })).toBeVisible();

  // A signed-out visitor can now open the profile.
  const response = await page.goto(`/tutors/${tutorId}`);
  expect(response?.status()).toBe(200);
  // Exact, because the qualifications panel also explains what "verified" means.
  await expect(page.getByText('Verified', { exact: true })).toBeVisible();
  await expect(page.getByText('BSc Mathematics — University of Lagos, 2013')).toBeVisible();
  await expect(page.getByText('$30.00').first()).toBeVisible();
});

test('a rejected tutor sees why, and can fix it and resubmit', async ({ page }) => {
  await signIn(page, ACCOUNTS.rejectedTutor);
  await page.goto('/tutor');

  await expect(page.getByText('Why your profile was not accepted')).toBeVisible();
  await expect(page.getByText(/does not match the name on your profile/)).toBeVisible();

  await page.goto('/tutor/onboarding/review');
  await expect(page.getByText('Your last submission was not accepted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeVisible();
});
