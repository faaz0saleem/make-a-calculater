/**
 * Search filters and sort (SPEC.md §4).
 *
 * One GET form, so every result set is a shareable URL and the whole thing
 * works without JavaScript.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Select } from '@/components/ui/select';
import { SORT_LABELS, SORT_OPTIONS, type DiscoveryFilters } from '@/db/discovery';
import { LANGUAGES } from '@/lib/tutors/languages';

export function Filters({
  filters,
  subjects,
  countries,
  resultCount,
}: {
  filters: DiscoveryFilters;
  subjects: { slug: string; name: string }[];
  countries: string[];
  resultCount: number;
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Subject" htmlFor="subject">
          <Select id="subject" name="subject" defaultValue={filters.subject ?? ''}>
            <option value="">Any subject</option>
            {subjects.map((subject) => (
              <option key={subject.slug} value={subject.slug}>
                {subject.name}
              </option>
            ))}
          </Select>
        </Field>

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

        <div className="flex items-end gap-4">
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
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-sm text-muted-foreground">
          {resultCount} tutor{resultCount === 1 ? '' : 's'} match. Only verified tutors are listed.
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Filtering by day and time arrives with the booking calendar in Phase&nbsp;3.
          </span>
          <Button type="submit" variant="outline" size="sm">
            Apply
          </Button>
        </div>
      </div>
    </form>
  );
}
