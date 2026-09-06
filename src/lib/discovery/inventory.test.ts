import { describe, expect, it } from 'vitest';

import {
  feedShape,
  RAILS_NEED_TUTORS,
  smallCatalogueNote,
  SPARSE_GRID_TUTORS,
} from './inventory';

describe('feedShape', () => {
  it('hides the rails until there are enough tutors for them to be a selection', () => {
    // The failure this prevents: "Free trials", "New tutors" and "All tutors"
    // showing the same three people, which reads as a padded, empty site.
    expect(feedShape(3, true).showRails).toBe(false);
    expect(feedShape(RAILS_NEED_TUTORS - 1, true).showRails).toBe(false);
    expect(feedShape(RAILS_NEED_TUTORS, true).showRails).toBe(true);
    expect(feedShape(40, true).showRails).toBe(true);
  });

  it('never shows rails to somebody who asked a question', () => {
    expect(feedShape(40, false).showRails).toBe(false);
  });

  it('says how small the catalogue is rather than letting three cards say it', () => {
    expect(feedShape(3, true).acknowledgeSmallCatalogue).toBe(true);
    expect(feedShape(SPARSE_GRID_TUTORS, true).acknowledgeSmallCatalogue).toBe(false);
    // Zero has its own empty state; this note would be noise on top of it.
    expect(feedShape(0, true).acknowledgeSmallCatalogue).toBe(false);
  });

  it('is about the catalogue, not the current search', () => {
    // A student whose declared class matches two tutors is looking at a narrow
    // result, not an empty marketplace. Passing the filtered count here folded
    // the filter panel away at the exact moment they needed it.
    const wholeCatalogue = feedShape(40, true);
    expect(wholeCatalogue.showFilters).toBe(true);
    expect(wholeCatalogue.acknowledgeSmallCatalogue).toBe(false);
  });

  it('gives an empty catalogue its own state rather than a filter apology', () => {
    // The day-one page. Telling somebody who has set no filters to clear their
    // filters is a dead end that also reads as broken.
    const empty = feedShape(0, true);
    expect(empty.catalogueEmpty).toBe(true);
    expect(empty.showFilters).toBe(false);
    expect(empty.showRails).toBe(false);

    // A filtered zero is a different thing and keeps the filter form.
    expect(feedShape(0, false).catalogueEmpty).toBe(false);
    expect(feedShape(0, false).showFilters).toBe(true);
  });

  it('changes the heading so a short list is not called "all tutors" defensively', () => {
    expect(feedShape(3, true).gridHeading).toBe('Every tutor on Tutorly');
    expect(feedShape(40, true).gridHeading).toBe('All tutors');
  });
});

describe('smallCatalogueNote', () => {
  it('is grammatical at one', () => {
    expect(smallCatalogueNote(1)).toContain('One tutor so far');
    expect(smallCatalogueNote(3)).toContain('3 tutors so far');
  });

  it('never claims more than there is', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(smallCatalogueNote(n)).toContain(n === 1 ? 'One' : String(n));
    }
  });
});
