/**
 * Boards and classes (SPEC.md §4).
 *
 * Shipped as a seed, owned here. A curriculum list is never finished — boards
 * rename themselves, countries reform their exams, and the next market will
 * want a board nobody in this repository has heard of. Waiting for a deploy to
 * add one is how a student ends up picking "Other".
 *
 * Nothing on this page deletes. Retiring a class takes it out of every picker
 * and leaves the declarations that already point at it alone.
 */

import { asc, sql } from 'drizzle-orm';

import { addBoard, addLevel, saveBoard, toggleLevel } from '@/app/admin/curriculum/actions';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, Select } from '@/components/ui/select';
import { db } from '@/db/client';
import { boardCountries, boards, curriculumLevels } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { CURRICULUM_STAGES, STAGE_LABELS } from '@/lib/curriculum/boards';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Boards and classes' };

export default async function AdminCurriculumPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireRole('admin');
  const query = await searchParams;

  const [boardRows, levelRows, countryRows, usage] = await Promise.all([
    db.select().from(boards).orderBy(asc(boards.sortOrder), asc(boards.name)),
    db
      .select()
      .from(curriculumLevels)
      .orderBy(asc(curriculumLevels.boardId), asc(curriculumLevels.sortOrder)),
    db.select().from(boardCountries).orderBy(asc(boardCountries.sortOrder)),
    db.execute(sql`
      select board_id, count(*)::int as tutors
      from (
        select board_id, tutor_id from tutor_curriculum
        union
        select board_id, student_id from student_curriculum
      ) declarations
      group by board_id
    `) as unknown as Promise<{ board_id: string; tutors: number }[]>,
  ]);

  const levelsByBoard = new Map<string, typeof levelRows>();
  for (const level of levelRows) {
    levelsByBoard.set(level.boardId, [...(levelsByBoard.get(level.boardId) ?? []), level]);
  }

  const countriesByBoard = new Map<string, string[]>();
  for (const row of countryRows) {
    countriesByBoard.set(row.boardId, [...(countriesByBoard.get(row.boardId) ?? []), row.country]);
  }

  const declared = new Map((await usage).map((row) => [row.board_id, Number(row.tutors)]));

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Boards and classes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A class belongs to a board — an AS Level under CBSE is nonsense, and the database refuses to
            store one. Countries decide the <em>order</em> a student sees, never which boards exist.
          </p>
        </div>

        {query.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}

        {query.saved ? (
          <p role="status" className="rounded-md bg-[var(--success)]/10 px-4 py-3 text-sm">
            Saved. Pickers and the feed are using it now.
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">Add a board</CardTitle>
            <CardDescription>
              The id appears in URLs and prefixes every class under it, so it cannot change afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={addBoard} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
              <Field label="Id" htmlFor="new-board-id" hint="e.g. wjec">
                <Input id="new-board-id" name="boardId" required pattern="[a-z0-9][a-z0-9-]{1,30}" />
              </Field>
              <Field label="Name" htmlFor="new-board-name">
                <Input id="new-board-name" name="name" required maxLength={120} />
              </Field>
              <Button type="submit" size="sm" className="min-h-11">
                Add board
              </Button>
            </form>
          </CardContent>
        </Card>

        {boardRows.map((board) => {
          const levels = levelsByBoard.get(board.id) ?? [];
          const countries = countriesByBoard.get(board.id) ?? [];
          const declaredCount = declared.get(board.id) ?? 0;

          return (
            <Card key={board.id} data-testid="admin-board" data-board={board.id}>
              <CardHeader>
                <CardTitle as="h2" className="flex flex-wrap items-center gap-2">
                  {board.name}
                  <span className="text-xs font-normal text-muted-foreground">{board.id}</span>
                  {board.isActive ? null : <Badge variant="outline">Hidden</Badge>}
                </CardTitle>
                <CardDescription>
                  {declaredCount === 0
                    ? 'Nobody has declared against this board yet.'
                    : `${declaredCount} tutor${declaredCount === 1 ? '' : 's'} and student${
                        declaredCount === 1 ? '' : 's'
                      } have declared against it.`}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col gap-6">
                <form action={saveBoard} className="grid gap-3 sm:grid-cols-[1fr_6rem_1fr_auto] sm:items-end">
                  <input type="hidden" name="boardId" value={board.id} />

                  <Field label="Name" htmlFor={`${board.id}-name`}>
                    <Input id={`${board.id}-name`} name="name" defaultValue={board.name} maxLength={120} />
                  </Field>

                  <Field label="Position" htmlFor={`${board.id}-sort`}>
                    <Input
                      id={`${board.id}-sort`}
                      name="sortOrder"
                      type="number"
                      min={0}
                      max={999}
                      defaultValue={board.sortOrder}
                    />
                  </Field>

                  <Field
                    label="Shown first in"
                    htmlFor={`${board.id}-countries`}
                    hint="Two-letter codes, best first. Everyone else still sees it, lower down."
                  >
                    <Input
                      id={`${board.id}-countries`}
                      name="countries"
                      defaultValue={countries.join(', ')}
                      placeholder="PK, AE, GB"
                    />
                  </Field>

                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={board.isActive}
                        className="size-4"
                      />
                      Offered
                    </label>
                    <Button type="submit" size="sm" variant="outline" className="min-h-11">
                      Save
                    </Button>
                  </div>
                </form>

                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">Classes</h3>

                  {levels.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      None yet. A board with no classes cannot be picked.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {levels.map((level) => (
                        <li
                          key={level.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            {level.name}
                            <span className="text-xs text-muted-foreground">{level.id}</span>
                            <Badge variant="secondary" className="text-[10px]">
                              {STAGE_LABELS[level.stage]}
                            </Badge>
                            {level.isActive ? null : <Badge variant="outline">Retired</Badge>}
                          </span>

                          <form action={toggleLevel}>
                            <input type="hidden" name="levelId" value={level.id} />
                            <input type="hidden" name="boardId" value={board.id} />
                            <Button type="submit" size="sm" variant="outline">
                              {level.isActive ? 'Retire' : 'Restore'}
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form
                    action={addLevel}
                    className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[8rem_1fr_1fr_5rem_auto] sm:items-end"
                  >
                    <input type="hidden" name="boardId" value={board.id} />

                    <Field label="Id" htmlFor={`${board.id}-level-id`} hint={`${board.id}:…`}>
                      <Input
                        id={`${board.id}-level-id`}
                        name="levelId"
                        required
                        pattern="[a-z0-9][a-z0-9-]{1,30}"
                      />
                    </Field>

                    <Field label="Name" htmlFor={`${board.id}-level-name`}>
                      <Input id={`${board.id}-level-name`} name="name" required maxLength={120} />
                    </Field>

                    <Field
                      label="Rung"
                      htmlFor={`${board.id}-level-stage`}
                      hint="What it lines up with on other boards."
                    >
                      <Select id={`${board.id}-level-stage`} name="stage" required defaultValue="">
                        <option value="" disabled>
                          Choose
                        </option>
                        {CURRICULUM_STAGES.map((stage) => (
                          <option key={stage} value={stage}>
                            {STAGE_LABELS[stage]}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field label="Position" htmlFor={`${board.id}-level-sort`}>
                      <Input
                        id={`${board.id}-level-sort`}
                        name="sortOrder"
                        type="number"
                        min={0}
                        max={999}
                        defaultValue={levels.length + 1}
                      />
                    </Field>

                    <Button type="submit" size="sm" className="min-h-11">
                      Add class
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </>
  );
}
