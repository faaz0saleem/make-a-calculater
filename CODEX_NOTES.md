# Content and SEO handoff

Base: `main` at `d228bc0fd29d781fb036fc3236dd902509af1072`.
Branch: `codex/content-and-seo`.
Read `SPEC.md` and all of `PROGRESS.md` before writing. Only new files in the
six assigned paths plus this explicitly requested note are included.

## Boundary stops — core-agent integration required

1. **Public access is blocked by the existing auth allowlist.**
   `src/auth.config.ts` only permits `/`, `/signin`, `/signup`, `/tutors`,
   `/api/auth` and `/api/health`. All new routes, including legal pages,
   `/sitemap.xml` and `/robots.txt`, currently redirect anonymous visitors to
   sign-in. The core owner must explicitly allow the intended public routes;
   keep member routes protected. I stopped that change and did not alter the
   auth config, middleware or use misleading prefixes to bypass the gate.

2. **The existing homepage must mount the signed-out introduction.**
   `src/app/page.tsx` owns `/` and its feed. Import `SignedOutIntro` from
   `src/app/(marketing)/_components/signed-out-intro.tsx` and render it above the
   feed only for a signed-out, unfiltered visit. Its default heading level is 2
   because the existing page already has an H1; set its `browseHref` to a real
   feed anchor, or add that anchor in the core-owned page. I stopped this edit
   and supplied `/welcome` as a separate signed-out preview. No duplicate `/`
   route was created. `/welcome` is noindex and redirects signed-in users home.

3. **Existing feed filter URLs still need indexing policy in the core page.**
   Every owned page has an absolute canonical. New SEO pages ignore filters for
   content and set noindex on every query-string variant; empty results are also
   noindex. The existing `/?board=...&level=...` pages cannot acquire canonical
   or noindex metadata without editing `src/app/page.tsx`. I stopped that edit.
   Robots deliberately allows query crawling so crawlers can read noindex;
   blocking them in robots would hide that instruction, not remove duplicates.

4. **Email wiring and dependencies belong to the notification owner.**
   `package.json`/`pnpm-lock.yaml` lack React Email and Resend. Components use
   email-safe React HTML compatible with their renderer, inline pixel styles
   and table layout. No root dependency files were changed. Add the chosen
   renderer/sender in the core workflow, resolve recipients, honour preferences,
   deduplicate committed events and attach `.ics` files. Every template has a
   typed plain-text fallback. See `src/emails/README.md` for all 14 groups.

5. **Do not turn incomplete policies into live promises.**
   - `src/lib/money/outcomes.ts` signals `freeSessionCredit: true` for tutor
     no-shows, but settlement does not award it; `DECISIONS_NEEDED.md` item 4
     leaves its value unresolved. No invented amount or automatic extra credit.
   - The same module floors cancellation notice to whole minutes. That makes
     24 hours plus less than a minute fall into the half-refund tier, while the
     requested policy says more than 24 hours is full. The draft flags the
     discrepancy; no money logic or tests in the boundary were touched.
   - Suspension holds, payout review deadlines and closure below $100 need an
     approved and implemented process in core-owned account/payout code. The
     draft preserves earned balances instead of inventing automatic forfeiture.
   - Under-18 flags and guardian emails exist, but full verifiable consent,
     public safeguarding contacts and a guardian dashboard do not. The privacy
     and child-safety drafts explicitly identify those gaps.
   - The existing lifetime trial-pair rule consumes declined/expired requests;
     see `DECISIONS_NEEDED.md` item 3. The terms describe the current restriction.
   - Complete legal operator identity, addresses, support/privacy/safeguarding
     contacts, effective dates, vendor locations and retention schedules with
     qualified counsel. Every legal page starts with the required draft label
     and is noindex. No sending service or regulator approval is implied.

## What this branch provides

- Five legal policies: `/terms`, `/privacy`, `/refund-policy`, `/tutor-agreement`,
  `/child-safety`, all visibly marked `DRAFT — REQUIRES LEGAL REVIEW`.
- A reusable signed-out introduction, `/welcome` preview, `/teach` recruitment
  page and `/pricing` explainer. Commission copy follows the later 22%/16%
  progress update, not the stale 20% in the original specification. Pricing
  reads current credit packs through the existing `listCreditPacks()` export.
- Six editorial search intents, resolved against active curriculum board and
  level rows and the subject catalogue, not copied seed tutors:
  `/caie-a-level-physics-tutors`, `/caie-as-level-physics-tutors`,
  `/edexcel-igcse-maths-tutors`, `/o-level-tutors-in-lahore`,
  `/urdu-speaking-chemistry-tutors`, `/caie-o-level-chemistry-tutors`.
  Every one has over 150 words of original course-specific copy, a unique H1
  and metadata, three FAQs, sibling links and matched tutor cards.
- Existing `searchTutors`, `listSubjects`, `listCurriculumOptions`,
  `getTutorCurriculum` and `ratingSummaryFor` exports are imported unchanged.
  No direct SQL or alternate visibility logic. Lahore checks the actual city
  and country and continues past the first result page; AS-only results exclude
  A2-only tutors; Urdu results require the language field and a matching
  Chemistry curriculum declaration. No dossiers or private documents are read.
- `Person` entities identify tutors. `AggregateRating` is on their tutoring
  `Service`, where schema.org permits it, using the real visible-review count
  and unadjusted mean. The same value is visible on the card. No review means
  no rating entity; hidden reviews and ranking priors are never fabricated into
  review data. JSON-LD escapes script delimiters and includes no student names.
  Structured data is not a promise of Google review stars for Person/Service.
- `AUTH_URL` supplies the absolute canonical origin. Set it to the production
  HTTPS origin at build and runtime; never infer a hostname from request headers.
  Local builds and Vercel previews are noindex. A non-Vercel staging deployment
  also needs a non-production environment/origin. Robots is not access control.
- Sitemap entries use the same active catalogue and positive inventory checks
  as page metadata. Draft policies, empty results, `/welcome`, query variants
  and member pages are omitted. Production database errors propagate rather
  than being disguised as empty or invented tutor data.
- All 14 SPEC §11 email groups, including accepted/declined, approved/rejected,
  requested/approved/paid and both cancellation sides, with plain-text output.

## Rendering and performance choices

The five policies and recruitment page are statically generated. SEO tutor
results are server-rendered on each request so suspension and hidden-review
changes take effect immediately and query variants can receive noindex.
React request memoization shares catalogue/results between metadata and page
rendering without retaining tutor data across requests. Pricing is dynamic
because administrators can change packs. There are no client data-fetch loops.

The core lacks city filtering, so the new data adapter pages the exported search
until it finds up to 12 exact city/curriculum matches or exhausts inventory.
At much larger inventory a core-owned city query would improve cost; I did not
add SQL or modify the exported query. Sitemap generation currently performs
matching/review reads for six intents; a dedicated public inventory query would
be a future optimisation, not required for this content-sized catalogue.

## Validation

- `pnpm typecheck && pnpm build`: passed, using the repo-pinned pnpm 10.33.0.
  Build produced the five static legal pages, static recruitment page and the
  new dynamic routes without route collisions.
- Build-only local environment supplied temporary auth/encryption values,
  `AUTH_URL=http://localhost:3000` and a local placeholder database URL. No
  live database, migration, seeding, payment or email service was used.
- `pnpm exec vitest run src/lib/seo/seo.test.ts src/lib/seo/data.test.ts`:
  18 tests passed, including exact curriculum matching, pagination beyond 60,
  no invented empty results on failure, canonical/noindex behavior and safe,
  review-backed JSON-LD.
- `pnpm exec vitest run --config src/emails/vitest.config.mts`:
  18 tests passed, exercising all 14 groups and status variants in HTML and
  text, DST conversion, exact integer amounts, unsafe URLs, HTML escaping,
  optional unsubscribe links and payout-data masking.
- Email tests have their own config and `.test.tsx` suffix because the existing
  root Vitest config only includes `.test.ts` and preserves JSX for Next.
  No existing test configuration was edited.
- Inspected built HTML for all five policies and `/teach`: exactly one H1 and
  one canonical each; all five legal documents contain the visible draft notice
  and noindex metadata.
- Build emits upstream Auth.js / jose warnings about CompressionStream and
  DecompressionStream in the Edge runtime. No authentication code was changed.
- Live database execution, public crawler access and actual sending remain
  unverified until the core integration and appropriate environment exist.
  The auth allowlist is a known blocker, not a passing end-to-end claim.

## Created files

- `CODEX_NOTES.md`
- `content/RESEARCH.md`
- `content/legal.ts`
- `content/seo-pages.ts`
- `src/app/(legal)/_components/policy-page.tsx`
- `src/app/(legal)/child-safety/page.tsx`
- `src/app/(legal)/privacy/page.tsx`
- `src/app/(legal)/refund-policy/page.tsx`
- `src/app/(legal)/terms/page.tsx`
- `src/app/(legal)/tutor-agreement/page.tsx`
- `src/app/(marketing)/_components/public-shell.tsx`
- `src/app/(marketing)/_components/signed-out-intro.tsx`
- `src/app/(marketing)/pricing/page.tsx`
- `src/app/(marketing)/teach/page.tsx`
- `src/app/(marketing)/welcome/page.tsx`
- `src/app/(seo)/[tutorSearch]/page.tsx`
- `src/app/(seo)/_components/tutor-results.tsx`
- `src/app/(seo)/robots.txt/route.ts`
- `src/app/(seo)/sitemap.xml/route.ts`
- `src/emails/README.md`
- `src/emails/_shared/email.tsx`
- `src/emails/_shared/format.ts`
- `src/emails/_shared/types.ts`
- `src/emails/booking-cancelled.tsx`
- `src/emails/booking-confirmed.tsx`
- `src/emails/credits-low.tsx`
- `src/emails/credits-purchased.tsx`
- `src/emails/emails.test.tsx`
- `src/emails/followed-tutor-slots.tsx`
- `src/emails/index.ts`
- `src/emails/new-review.tsx`
- `src/emails/payout-status.tsx`
- `src/emails/reminder-1h.tsx`
- `src/emails/reminder-24h.tsx`
- `src/emails/session-completed.tsx`
- `src/emails/session-starting.tsx`
- `src/emails/trial-decision.tsx`
- `src/emails/trial-requested.tsx`
- `src/emails/verification-decision.tsx`
- `src/emails/vitest.config.mts`
- `src/lib/seo/catalogue.ts`
- `src/lib/seo/crawlers.ts`
- `src/lib/seo/data.test.ts`
- `src/lib/seo/data.ts`
- `src/lib/seo/seo.test.ts`
- `src/lib/seo/site.ts`
- `src/lib/seo/structured-data.ts`
