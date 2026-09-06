/**
 * Search filters and sort (SPEC.md §4).
 *
 * One GET form, so every result set is a shareable URL and the whole thing
 * works without JavaScript.
 */

import { CurriculumFields, type BoardChoice } from '@/components/curriculum/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Select } from '@/components/ui/select';
import { SORT_LABELS, SORT_OPTIONS, type DiscoveryFilters } from '@/db/discovery';
import { LANGUAGES } from '@/lib/tutors/languages';

/** Half-hour options for the day-and-time window. */
const TIMES = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? '00' : '30';
  return `${String(hour).padStart(2, '0')}:${minute}`;
});

export function Filters({
  filters,
  subjects,
  boards,
  countries,
  resultCount,
  timeWindow,
  viewerTimezone,
  curriculum,
  exactOnly,
  collapsed = false,
}: {
  filters: DiscoveryFilters;
  subjects: { slug: string; name: string }[];
  boards: BoardChoice[];
  countries: string[];
  resultCount: number;
  /** The raw day/time values, so the form can render what was submitted. */
  timeWindow: { date?: string; from?: string; to?: string };
  viewerTimezone: string;
  /** The board and class currently in the URL, so the form renders them back. */
  curriculum: { board?: string; level?: string };
  exactOnly: boolean;
  /**
   * Start folded, showing only the search box.
   *
   * Twelve controls above three results is a form apologising for the
   * catalogue. It is a `details` element, so it still opens without
   * JavaScript, and it opens itself whenever a filter is already set — landing
   * on a filtered URL and not being able to see the filter would be worse.
   */
  collapsed?: boolean;
}) {
  return (
    <form
      method="get"
      action="/"
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
      aria-label="Search and filter tutors"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          name="q"
          type="search"
          defaultValue={filters.q ?? ''}
          placeholder="Search by name, subject or what they teach"
          aria-label="Search tutors"
        />
        <Button type="submit">Search</Button>
      </div>

      <details open={!collapsed} className="flex flex-col gap-4">
        <summary className="cursor-pointer text-sm font-medium marker:text-muted-foreground">
          {collapsed ? 'More ways to narrow it down' : 'Filters'}
        </summary>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CurriculumFields
          boards={boards}
          subjects={subjects}
          value={{
            board: curriculum.board,
            level: curriculum.level,
            subject: filters.subject,
          }}
        />

        <Field label="Language" htmlFor="language">
          <Select id="language" name="language" defaultValue={filters.language ?? ''}>
            <option value="">Any language</option>
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Minimum rating" htmlFor="minRating">
          <Select id="minRating" name="minRating" defaultValue={filters.minRatingMilli?.toString() ?? ''}>
            <option value="">Any rating</option>
            <option value="4800">4.8+</option>
            <option value="4500">4.5+</option>
            <option value="4000">4.0+</option>
            <option value="3500">3.5+</option>
          </Select>
        </Field>

        <Field label="Country" htmlFor="country">
          <Select id="country" name="country" defaultValue={filters.country ?? ''}>
            <option value="">Anywhere</option>
            {countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Price from" htmlFor="minPrice" hint="Dollars per hour.">
          <Input
            id="minPrice"
            name="minPrice"
            type="number"
            min={5}
            max={200}
            step={1}
            placeholder="5"
            defaultValue={filters.minPriceCents ? filters.minPriceCents / 100 : ''}
          />
        </Field>

        <Field label="Price to" htmlFor="maxPrice">
          <Input
            id="maxPrice"
            name="maxPrice"
            type="number"
            min={5}
            max={200}
            step={1}
            placeholder="200"
            defaultValue={filters.maxPriceCents ? filters.maxPriceCents / 100 : ''}
          />
        </Field>

        <Field label="Sort by" htmlFor="sort">
          <Select id="sort" name="sort" defaultValue={filters.sort ?? 'relevance'}>
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {SORT_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="freeTrial"
              value="1"
              defaultChecked={filters.hasFreeTrial}
              className="size-4"
            />
            Free trial
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="exact" value="1" defaultChecked={exactOnly} className="size-4" />
            Exact board and class only
          </label>
        </div>
      </div>

      <fieldset className="grid gap-3 border-t border-border pt-4 sm:grid-cols-4">
        <legend className="sr-only">Free at a particular time</legend>

        <Field label="Free on" htmlFor="availDate" hint={`Times in ${viewerTimezone}.`}>
          <Input id="availDate" name="availDate" type="date" defaultValue={timeWindow.date ?? ''} />
        </Field>

        <Field label="Between" htmlFor="availFrom">
          <Select id="availFrom" name="availFrom" defaultValue={timeWindow.from ?? '09:00'}>
            {TIMES.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="And" htmlFor="availTo">
          <Select id="availTo" name="availTo" defaultValue={timeWindow.to ?? '21:00'}>
            {TIMES.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end">
          <p className="text-xs text-muted-foreground">
            Checked against each tutor&rsquo;s real calendar — their hours, minus sessions already booked,
            their buffer between sessions and any time blocked off.
          </p>
        </div>
      </fieldset>

      </details>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-sm text-muted-foreground">
          {resultCount} tutor{resultCount === 1 ? '' : 's'} match. Only verified tutors are listed.
        </p>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </div>
    </form>
  );
}
