/**
 * Phase 6 Part A: curriculum matching, through the real UI.
 *
 * The claim these tests exist to hold is one sentence: **an exact curriculum
 * match outweighs a rating.** It is easy to write and easy to lose — one
 * `order by score desc` in the wrong place and a 4.9 tutor who teaches nothing
 * the student sits is back at the top of the feed, silently.
 */

import { expect, test } from '@playwright/test';

import { ACCOUNTS, queryDatabase, signIn, signOut } from './helpers';

test.describe.configure({ mode: 'serial' });

test('the database refuses a class that belongs to another board', async () => {
  // The same guarantee `pnpm prove:curriculum` demonstrates, asserted here so
  // it cannot be lost by a migration that drops the composite key.
  const failure = await queryDatabase(async (sql) => {
    const [student] = await sql`select id from users where email = ${ACCOUNTS.student}`;
    const [subject] = await sql`select id from subjects where slug = 'math'`;

    try {
      await sql.begin(async (tx) => {
        await tx`
          insert into student_curriculum (student_id, board_id, level_id, subject_id, is_primary)
          values (${student!.id}, 'cbse', 'caie:as-level', ${subject!.id}, false)
        `;
      });
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  });

  // 23503: foreign key violation. The pairing is not a rule the app applies.
  expect(failure).toBe('23503');
});

test('a student sees their class applied, and can clear it in one tap', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await page.goto('/');

  const banner = page.getByTestId('curriculum-banner');
  await expect(banner).toHaveAttribute('data-state', 'applied');
  await expect(banner).toHaveAttribute('data-source', 'profile');
  await expect(page.getByTestId('curriculum-position')).toHaveText('Cambridge (CAIE) · AS Level · Math');

  // One tap.
  await banner.getByRole('link', { name: 'Show all tutors' }).click();
  await expect(page.getByTestId('curriculum-banner')).toHaveAttribute('data-state', 'cleared');

  // And one tap back.
  await page.getByRole('link', { name: 'Match my class again' }).click();
  await expect(page.getByTestId('curriculum-banner')).toHaveAttribute('data-state', 'applied');
});

test('an exact curriculum match outranks a better rating', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  // Cleared, so this is the whole feed rather than a filtered slice — which is
  // the harder case: every non-matching tutor is present and still loses.
  await page.goto('/?noCurriculum=1');

  const grid = page.locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) });
  const cards = grid.getByTestId('tutor-card');
  await expect(cards.first()).toBeVisible();

  const order = await cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const label = node.querySelector('[data-testid="match-label"]');
      return {
        // The heading carries a verified tick after the name.
        name: (node.querySelector('h3')?.textContent ?? '').replace(/[^\p{L}\p{M}\s'-]/gu, '').trim(),
        exact: label?.getAttribute('data-exact') === 'true',
        matched: Boolean(label),
      };
    }),
  );

  const exact = order.filter((row) => row.exact);
  expect(exact.length).toBeGreaterThan(0);

  // Every exact match appears above every tutor who is not a match at all.
  const lastExact = order.map((row) => row.exact).lastIndexOf(true);
  const firstUnmatched = order.findIndex((row) => !row.matched);
  expect(firstUnmatched).toBeGreaterThan(lastExact);

  // The card rounds a rating to one decimal, so the comparison uses the stored
  // value. 4.563 and 4.6 both render as "4.6" and would hide the whole point.
  const ratings = await queryDatabase(async (sql) => {
    const rows = await sql`
      select u.name, r.bayesian_rating_milli as milli
      from tutor_ranking r join users u on u.id = r.tutor_id
    `;
    return new Map(rows.map((row) => [row.name as string, Number(row.milli)]));
  });

  // The promise itself, on real data: somewhere on this page an exact match
  // sits above a tutor with a *better* rating who teaches something else. Not
  // "usually" — the pair has to be there, or the rule is doing nothing.
  const beaten = order.flatMap((above, index) => {
    const aboveRating = ratings.get(above.name);
    if (!above.exact || aboveRating === undefined) return [];

    return order
      .slice(index + 1)
      .filter((below) => !below.matched && (ratings.get(below.name) ?? 0) > aboveRating)
      .map((below) => `${below.name} ${ratings.get(below.name)} above-rated but below ${above.name} ${aboveRating}`);
  });

  expect(beaten.length).toBeGreaterThan(0);
});

test('the tiers are ordered, and each card says which one it is', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await page.goto('/?noCurriculum=1');

  const grid = page.locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) });
  const labels = await grid
    .getByTestId('tutor-card')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('[data-testid="match-label"]')?.textContent?.trim() ?? ''),
    );

  const rank = (label: string) => {
    if (label.includes('exact board, class and subject')) return 3;
    if (label.includes('board and subject at another level')) return 2;
    if (label.includes('subject at your level on another board')) return 1;
    return 0;
  };

  const ranks = labels.map(rank);
  expect(Math.max(...ranks)).toBe(3);
  for (let index = 1; index < ranks.length; index += 1) {
    expect(ranks[index]!).toBeLessThanOrEqual(ranks[index - 1]!);
  }
});

test('the feed filters on the triple, and offers a way out when nothing matches', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);

  // A real position nobody in the seed teaches: IB Diploma Year 2 music.
  await page.goto('/?board=ib&level=ib%3Adp-2&subject=music&exact=1');

  await expect(page.getByRole('heading', { name: /No tutor teaches/ })).toBeVisible();
  await page.getByRole('link', { name: 'see every tutor' }).click();

  const grid = page.locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) });
  await expect(grid.getByTestId('tutor-card').first()).toBeVisible();
});

test('a visitor with no account still gets a board list, ordered for where they are', async ({ page }) => {
  await signOut(page);
  await page.goto('/');

  // Nothing is applied to an anonymous visitor — there is nothing to apply.
  await expect(page.getByTestId('curriculum-banner')).toHaveCount(0);

  const options = await page
    .locator('select[name="board"] option')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));

  expect(options).toContain('Cambridge (CAIE)');
  expect(options).toContain('Punjab Board');
  // Always available, always last.
  expect(options[options.length - 1]).toBe('Other / not listed');
});

test('a tutor declares what they teach, capped at fifteen', async ({ page }) => {
  // The row this test adds, removed first as well as last, so a re-run after a
  // failure starts from the seeded world rather than from the last attempt.
  const clean = () =>
    queryDatabase(async (sql) => {
      await sql`
        delete from tutor_curriculum
        where level_id = 'caie:o-level'
          and tutor_id = (select id from users where email = ${ACCOUNTS.verifiedTutor})
      `;
    });

  await clean();

  await signIn(page, ACCOUNTS.verifiedTutor);
  await page.goto('/tutor/onboarding/subjects');

  const rows = page.getByTestId('curriculum-row');
  await expect(rows.first()).toBeVisible();

  // The form always carries one blank row, so the first position takes no
  // extra click.
  const declared = (await rows.count()) - 1;
  expect(declared).toBe(6); // what the seed gives this tutor

  await page.getByRole('button', { name: 'Add another' }).click();
  await expect(rows).toHaveCount(declared + 2);
  await expect(page.getByText(`${declared} of 15 used`)).toBeVisible();

  const last = rows.last();
  await last.locator('select[name="positionBoard"]').selectOption('caie');
  await last.locator('select[name="positionLevel"]').selectOption('caie:o-level');
  await last.locator('select[name="positionSubject"]').selectOption('math');
  await page.getByRole('button', { name: 'Save what I teach' }).click();

  await page.waitForURL(/saved=curriculum/);
  // One more declared position than before, plus the blank row.
  await expect(page.getByTestId('curriculum-row')).toHaveCount(declared + 2);

  const stored = await queryDatabase(async (sql) => {
    const found = await sql`
      select count(*)::int as total
      from tutor_curriculum tc
      join users u on u.id = tc.tutor_id
      where u.email = ${ACCOUNTS.verifiedTutor} and tc.level_id = 'caie:o-level'
    `;
    return found[0]!.total as number;
  });
  expect(stored).toBe(1);

  // The subject picker only offers subjects already on the profile, because a
  // position is always *for* something the tutor claims to teach.
  const subjectOptions = await rows
    .first()
    .locator('select[name="positionSubject"] option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean));
  expect(subjectOptions.sort()).toEqual(['math', 'physics']);

  await clean();
});

test('the admin screen flags a mismatch, and stays quiet on a match', async ({ page }) => {
  // Both halves matter. A flag that fires on every profile is wallpaper, so
  // this drives the same tutor through both cases and puts them back after.
  const { tutorId, subjects, credentials } = await queryDatabase(async (sql) => {
    const [tutor] = await sql`
      select user_id from tutor_profiles where status = 'pending_review'
      order by submitted_at limit 1
    `;
    const id = tutor!.user_id as string;

    return {
      tutorId: id,
      subjects: await sql`select * from tutor_subjects where tutor_id = ${id}`,
      credentials: await sql`select id, kind, title, institution from credentials where tutor_id = ${id}`,
    };
  });

  const claim = (subjectSlug: string, title: string) =>
    queryDatabase(async (sql) => {
      await sql`delete from tutor_subjects where tutor_id = ${tutorId}`;
      await sql`
        insert into tutor_subjects (tutor_id, subject_id, level, years_experience)
        select ${tutorId}, id, 'intermediate', 3 from subjects where slug = ${subjectSlug}
      `;
      // The institution counts too: "UK Department for Education" contains
      // "education", which the flag reads as a teaching qualification.
      await sql`
        update credentials
        set kind = 'degree', title = ${title}, institution = 'University of Punjab'
        where tutor_id = ${tutorId}
      `;
    });

  try {
    await signIn(page, ACCOUNTS.admin);

    // A mathematics degree and a claim to teach music.
    await claim('music', 'BSc Mathematics');
    await page.goto(`/admin/verification/${tutorId}`);
    await expect(page.getByTestId('credential-flags')).toBeVisible();
    await expect(page.getByTestId('credential-flags')).toContainText('Music');
    await expect(page.getByTestId('credential-flag').first()).toBeVisible();

    // A flag, not a decision: approve is still there and still enabled.
    await expect(page.getByRole('button', { name: /Approve/ })).toBeEnabled();

    // The same degree and a claim to teach maths.
    await claim('math', 'BSc Mathematics');
    await page.goto(`/admin/verification/${tutorId}`);
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    await expect(page.getByTestId('credential-flags')).toHaveCount(0);
  } finally {
    await queryDatabase(async (sql) => {
      await sql`delete from tutor_subjects where tutor_id = ${tutorId}`;
      for (const row of subjects) {
        await sql`
          insert into tutor_subjects (tutor_id, subject_id, level, years_experience)
          values (${tutorId}, ${row.subject_id}, ${row.level}, ${row.years_experience})
        `;
      }
      for (const row of credentials) {
        await sql`
          update credentials
          set kind = ${row.kind}, title = ${row.title}, institution = ${row.institution}
          where id = ${row.id}
        `;
      }
    });
  }
});

test('the verification queue is not a wall of flags', async ({ page }) => {
  // The seeded world is coherent on purpose: a tutor's documents usually have
  // something to do with what they teach. If most of the queue is flagged, the
  // flag has stopped meaning anything and this test is the thing that says so.
  const pending = await queryDatabase(async (sql) => {
    const rows = await sql`
      select user_id from tutor_profiles where status = 'pending_review' order by submitted_at
    `;
    return rows.map((row) => row.user_id as string);
  });

  await signIn(page, ACCOUNTS.admin);

  let flagged = 0;
  for (const tutorId of pending) {
    await page.goto(`/admin/verification/${tutorId}`);
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    if ((await page.getByTestId('credential-flags').count()) > 0) flagged += 1;
  }

  expect(pending.length).toBeGreaterThan(2);
  // At least one, so an admin sees what the flag looks like — and a minority,
  // so they still read it.
  expect(flagged).toBeGreaterThan(0);
  expect(flagged).toBeLessThan(pending.length / 2);
});

test('a student with no class is asked once, in the feed, and never walled', async ({ page }) => {
  // The seed gives every student a class, so this test makes one without —
  // and puts it back. Nothing else in the file may run between.
  const saved = await queryDatabase(async (sql) => {
    const rows = await sql`
      select sc.* from student_curriculum sc
      join users u on u.id = sc.student_id
      where u.email = ${ACCOUNTS.student}
    `;
    await sql`
      delete from student_curriculum
      where student_id = (select id from users where email = ${ACCOUNTS.student})
    `;
    return rows;
  });

  try {
    await signIn(page, ACCOUNTS.student);
    await page.goto('/');

    // The feed still works. The question is inline, not a gate.
    const grid = page.locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) });
    await expect(grid.getByTestId('tutor-card').first()).toBeVisible();

    const prompt = page.getByTestId('curriculum-prompt');
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId('curriculum-banner')).toHaveCount(0);

    await prompt.locator('select[name="board"]').selectOption('caie');
    await prompt.locator('select[name="level"]').selectOption('caie:a2-level');
    await prompt.locator('select[name="subject"]').selectOption('physics');
    await prompt.getByRole('button', { name: 'Show tutors who teach this' }).click();

    await expect(page.getByTestId('curriculum-position')).toHaveText(
      'Cambridge (CAIE) · A2 Level · Physics',
    );
    await expect(page.getByTestId('curriculum-prompt')).toHaveCount(0);

    // And it is one row, marked primary, not a pile.
    const stored = await queryDatabase(async (sql) => {
      return sql`
        select sc.board_id, sc.level_id, sc.is_primary
        from student_curriculum sc join users u on u.id = sc.student_id
        where u.email = ${ACCOUNTS.student}
      `;
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.is_primary).toBe(true);
  } finally {
    await queryDatabase(async (sql) => {
      await sql`
        delete from student_curriculum
        where student_id = (select id from users where email = ${ACCOUNTS.student})
      `;
      for (const row of saved) {
        await sql`
          insert into student_curriculum (id, student_id, board_id, level_id, subject_id, is_primary, created_at)
          values (${row.id}, ${row.student_id}, ${row.board_id}, ${row.level_id}, ${row.subject_id}, ${row.is_primary}, ${row.created_at})
        `;
      }
    });
  }
});

test('two students on opposite sides of the world get different orders', async ({ page }) => {
  // The timezone-overlap term, end to end. Same student, same class, same
  // tutors — only the hours they could actually sit down change.
  const original = await queryDatabase(async (sql) => {
    const rows = await sql`select timezone from users where email = ${ACCOUNTS.student}`;
    return rows[0]!.timezone as string;
  });

  const orderIn = async (timezone: string): Promise<{ names: string[]; total: string }> => {
    await queryDatabase(async (sql) => {
      await sql`update users set timezone = ${timezone} where email = ${ACCOUNTS.student}`;
    });
    // The session carries the timezone, so it takes a fresh sign-in to change.
    await signOut(page);
    await signIn(page, ACCOUNTS.student);
    await page.goto('/?noCurriculum=1');

    const grid = page.locator('section', { has: page.getByRole('heading', { name: 'All tutors' }) });
    await expect(grid.getByTestId('tutor-card').first()).toBeVisible();

    const names = await grid
      .getByTestId('tutor-card')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node.querySelector('h3')?.textContent ?? '').replace(/[^\p{L}\p{M}\s'-]/gu, '').trim()),
      );
    const total = (await page.getByText(/tutors match/).first().textContent()) ?? '';
    return { names, total };
  };

  try {
    const karachi = await orderIn('Asia/Karachi');
    const losAngeles = await orderIn('America/Los_Angeles');

    // An ordering term, not a filter: the same tutors match either way, and
    // nobody disappears for being asleep. Only who leads changes.
    expect(karachi.total).toBe(losAngeles.total);
    expect(karachi.names.length).toBe(losAngeles.names.length);
    expect(karachi.names).not.toEqual(losAngeles.names);
    // The pages overlap heavily — this moves tutors, it does not replace them.
    const shared = karachi.names.filter((name) => losAngeles.names.includes(name));
    expect(shared.length).toBeGreaterThan(karachi.names.length / 2);
  } finally {
    await queryDatabase(async (sql) => {
      await sql`update users set timezone = ${original} where email = ${ACCOUNTS.student}`;
    });
  }
});

test('the nightly job, not the request, computes each tutor\'s free hours', async () => {
  const rows = await queryDatabase(async (sql) => {
    return sql`
      select u.timezone, r.free_hours_mask as mask
      from tutor_ranking r join users u on u.id = r.tutor_id
    `;
  });

  expect(rows.length).toBeGreaterThan(20);
  // Every ranked tutor has published hours in the seed, so every mask is real.
  expect(rows.every((row) => Number(row.mask) > 0)).toBe(true);
  // And tutors in different timezones do not all share one mask, which is what
  // a mask computed from the server's clock instead of theirs would look like.
  expect(new Set(rows.map((row) => Number(row.mask))).size).toBeGreaterThan(3);
});

test('the curriculum picker is reachable from the keyboard, with a visible focus ring', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.student);
  await page.goto('/');

  const board = page.locator('select[name="board"]');
  await expect(board).toBeVisible();

  // Tab until we land on it, rather than clicking: this is the path somebody
  // using a keyboard or a switch device actually takes.
  for (let press = 0; press < 40; press += 1) {
    if (await board.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }

  await expect(board).toBeFocused();

  const ring = await board.evaluate((element) => {
    const style = getComputedStyle(element);
    return { focusVisible: element.matches(':focus-visible'), boxShadow: style.boxShadow };
  });

  expect(ring.focusVisible).toBe(true);
  expect(ring.boxShadow).not.toBe('none');

  // Choosing a board narrows the class list to that board's, which is the whole
  // point of a board-aware picker — and it has to work from the keyboard too.
  await page.keyboard.press('Tab');
  const level = page.locator('select[name="level"]');
  await expect(level).toBeFocused();

  await board.selectOption('cbse');
  const groups = await level
    .locator('optgroup')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptGroupElement).label));
  expect(groups).toEqual(['CBSE']);
});
