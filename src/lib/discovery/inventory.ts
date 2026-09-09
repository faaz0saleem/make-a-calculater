/**
 * What the feed should look like when there is barely anything in it
 * (SPEC.md §4).
 *
 * The seeded world has forty tutors. Launch has three, and every surface that
 * assumes depth looks broken on day one: rails that are the grid again under a
 * different heading, category chips that lead nowhere, a filter panel taller
 * than its own results. None of that is a bug in the usual sense — each piece
 * works — and all of it says "this place is empty" to the first person through
 * the door.
 *
 * So the shape of the page is a function of how much there is to show, decided
 * here rather than by six components each guessing.
 */

/**
 * Below this, a rail is not a selection — it is the whole catalogue with a
 * heading on it.
 *
 * Eight is deliberate: a rail shows about four cards before scrolling, so a
 * rail drawn from fewer than double that is mostly the same faces the grid
 * below is about to show again. A student seeing Farah three times does not
 * think "curated", they think "is that all there is".
 */
export const RAILS_NEED_TUTORS = 8;

/** Below this, the grid is a short list and should be introduced as one. */
export const SPARSE_GRID_TUTORS = 6;

/**
 * Below this, the filter panel costs more than it earns and starts folded.
 *
 * A panel of eight controls is the right shape in front of forty tutors and
 * the wrong one in front of eight, where scrolling the whole grid is faster
 * than deciding what to narrow. Twenty is where scanning stops being the
 * quicker option — roughly two screens of cards on a phone.
 *
 * Folded, not hidden. The moment somebody *has* filtered, the panel is open
 * whatever the catalogue size, because that is when they need to widen it —
 * the mistake caught in P5 and worth not making twice in the other direction.
 */
export const FILTERS_EARN_THEIR_SPACE = 20;

export type FeedShape = {
  /** Rails between the chips and the grid. */
  showRails: boolean;
  /** Say how few there are, rather than letting a three-card grid speak. */
  acknowledgeSmallCatalogue: boolean;
  /**
   * There is nothing at all, and no filter caused it.
   *
   * The day-one state, and the one that most needs its own words: "nothing
   * matched those filters" in front of somebody who has not set a filter reads
   * as a broken site, and the fix they are being offered — clear your
   * filters — does nothing.
   */
  catalogueEmpty: boolean;
  /** Filtering an empty catalogue is a form with nothing behind it. */
  showFilters: boolean;
  /**
   * Show the panel, but closed.
   *
   * Only ever a default for somebody who has not filtered yet; the call site
   * opens it as soon as any filter is set.
   */
  foldFilters: boolean;
  /** The heading over the grid. */
  gridHeading: string;
};

/**
 * `visibleTutors` is the size of the whole catalogue, never the current result
 * count. Folding the filters away because *this search* matched two tutors
 * hides the controls somebody needs to widen it.
 */
export function feedShape(visibleTutors: number, browsing: boolean): FeedShape {
  if (!browsing) {
    return {
      showRails: false,
      acknowledgeSmallCatalogue: false,
      catalogueEmpty: false,
      showFilters: true,
      foldFilters: false,
      gridHeading: 'Results',
    };
  }

  return {
    showRails: visibleTutors >= RAILS_NEED_TUTORS,
    acknowledgeSmallCatalogue: visibleTutors > 0 && visibleTutors < SPARSE_GRID_TUTORS,
    catalogueEmpty: visibleTutors === 0,
    showFilters: visibleTutors > 0,
    foldFilters: visibleTutors > 0 && visibleTutors < FILTERS_EARN_THEIR_SPACE,
    gridHeading: visibleTutors < SPARSE_GRID_TUTORS ? 'Every tutor on Tutorly' : 'All tutors',
  };
}

/**
 * How to describe a very small catalogue without apologising for it.
 *
 * The honest framing is the one that is also the most attractive: a small
 * roster is a vetted roster. What it must not do is pretend — "12 tutors
 * matched" over three cards is the sentence that loses somebody's trust for
 * good.
 */
export function smallCatalogueNote(visibleTutors: number): string {
  if (visibleTutors === 1) {
    return 'One tutor so far. We verify every one by hand before they appear here, and we are adding them a few at a time.';
  }

  return `${visibleTutors} tutors so far. We verify every one by hand before they appear here, and we are adding them a few at a time.`;
}
