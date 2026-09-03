# Progress

Phases follow `SPEC.md` §15.

| Phase | Status |
|---|---|
| 0 — repo, schema, migrations, auth, seed | **Done** |
| 1 — tutor onboarding wizard + admin verification queue | **Done** |
| 2 — discovery feed, search, filters, tutor profile | **Done** |
| 3 — availability engine + booking + credits | Not started |
| 4 — LiveKit calls + session state machine + settlement | Not started |
| 5 — trials, messaging, reviews, follows | Not started |
| 6 — payouts + admin dashboard + audit log | Not started |
| 7 — real payment provider, notifications, SEO, analytics | Not started |

---

## Phase 2 — done

### The intro video pipeline

One upload becomes an HLS ladder (the profile hero), a short muted MP4 (the card
preview), and three thumbnail candidates the tutor picks between. `checkIntroLength`
enforces the 30–90 second rule from `SPEC.md` §3 against the probed duration, so
the wrong clip is rejected with a message naming its actual length.

Behind `VideoPipeline`. `FfmpegVideoPipeline` runs locally; production needs a
hosted transcoder because Vercel has no ffmpeg — which of Mux or Cloudflare
Stream is an account decision, so it is `DECISIONS_NEEDED.md` item 13 rather
than a guess in code. Without a pipeline the video is marked `failed` with a
message the tutor can read, not a 500.

**Uploads now go straight to the bucket.** This came out of the e2e run: a
Server Action caps its body at 1 MB and a Vercel function at 4.5 MB, so posting
a video through the app could never have worked, and raising a config value
would not have fixed it. The browser asks for an upload target, PUTs the bytes
to R2 (or, with no R2, to a signed path on our own upload route, which as a
Route Handler has no such cap), and hands the server only the key. Credentials
and avatars still post through a Server Action and are capped at 4 MB so they
fit; a test asserts that relationship holds.

### Discovery

- **Cards** autoplay muted for eight seconds — on hover with a pointer, at 50%
  of the viewport without one — and stop themselves. `prefers-reduced-motion`
  suppresses it entirely. The preview is the MP4, not the HLS ladder: a card
  should not load a streaming player to show eight seconds of someone talking.
- **Badges** come from one tested function: `Free trial`, `Responds in <1h`,
  `New`, and `Available today` — which is never shown, because availability is
  Phase 3.
- **Rails**: category chips, *Continue with your tutors* (built from settled
  paid bookings, not a browsing trail), *Free trials*, *New tutors* (exactly the
  tutors the score still gives an exploration boost), and *Top rated in {your
  last searched subject}* (a cookie set in middleware). Rails step aside when
  someone actually searches.
- **Search and filters**: full text over name, headline, bio and subject names;
  subject, language, price range, minimum rating, free trial and country;
  sorted by relevance, price, rating or sessions.
- **Profile page**: video hero with a real player, and qualifications as
  institution and year only — never the document.

### Ranking

`tutor_ranking` is written by a nightly job and read by the feed as a single
indexed column. Nothing computes a ranking in the request path.

The score is the weighted sum from `SPEC.md` §4, in basis points, in
`src/lib/ranking/score.ts` — pure, and tested against the behaviours that matter:
one 5★ review does not outrank two hundred; a quiet tutor slips below an active
one; a new tutor gets a foothold above a middling tutor but not above a strong
one, and loses it after 30 days or 20 sessions.

Two things the tests changed:

- **Response speed decays logarithmically.** Linearly, replying in an hour
  scored 97% against 15 minutes' 100% — which makes the term meaningless when
  the badge students look for is "Responds in <1h". An hour now scores ~70%.
- **Unranked tutors sort last, not first.** Postgres puts NULLs first in a DESC
  sort, so a tutor verified since the last nightly run would silently top the
  entire feed. They now sort last, and approving a tutor scores that one row
  immediately so they do not sit there until 3am.

Both cron entries are in `vercel.json`, behind `CRON_SECRET`.

### Availability is a port, not a half-built engine

`src/lib/availability/` is a four-method interface whose only implementation
returns `unknown` for everything, with `TODO(phase-3)` naming the real source.
It is deliberately three-valued: the feed can tell "has nothing free" apart from
"nobody has asked the calendar", and only the first is worth showing anyone.

Callers render nothing rather than guessing. The "Available in the next hour"
rail says what it is waiting for. The day-and-time filter is labelled as
arriving with the calendar. The ranking term scores at a neutral constant, which
cancels out of the ordering entirely rather than penalising everyone by 15%.

### Phase 1 follow-up, as agreed

Verified tutors now edit their profile freely — bio, rates, subjects, hours,
video — without leaving the feed. Changing a **document** sends them back to
`pending_review`, because the document is the claim an admin actually checked.
The credentials step says so plainly before they do it.

---

## Verified end to end

`pnpm e2e` reseeds and runs 18 Playwright specs. The Phase 2 twelve cover:

- the feed rendering seeded tutors, with posters and previews from the pipeline
- hover autoplay: play called on the right element, muted, on the preview MP4
- leaving rewinds it; the timer stops it after eight seconds
- the rails, including the one that admits it needs Phase 3, and that no card
  claims a next-free slot or an "Available today" badge
- *Continue with your tutors* appearing only once signed in
- category chips filtering and driving the top-rated rail through the cookie
- search narrowing results and pushing the rails aside
- the price filter and price sort agreeing (they did not: the filter used the
  promo price and the sort used the list price, so $6.40 sorted after $8.00)
- the feed order matching `tutor_ranking` read straight from the database
- the profile hero, and no document links anywhere on a public profile

**One caveat about the autoplay tests.** The preview is H.264/AAC, which every
real browser plays. The open-source Chromium Playwright ships deliberately
excludes proprietary codecs — it reports `canPlayType` empty for H.264 and fails
to demux. Asserting that pixels move would be testing Chromium's build flags,
so those tests assert the behaviour that is ours: that play is called on the
right element, muted, and stopped on schedule.

---

## What is stubbed

| Piece | State |
|---|---|
| Availability | A port with a stub, by design. `TODO(phase-3)` in `src/lib/availability/`. The real engine is `SPEC.md` §5. |
| Hosted transcoding | `FfmpegVideoPipeline` works locally. Production needs Mux or Cloudflare Stream — `DECISIONS_NEEDED.md` item 13. |
| Transcoding is inline | Fine for a 90-second clip in development; production should queue it (`SPEC.md` §14). Item 14. |
| Infinite scroll | The grid shows the first 24 with a count. Paging is a small addition once there is enough supply to need it. |
| Booking | The `Book session` button is disabled. `assertBookable` is the gate Phase 3's booking mutation calls. |
| Day/time filter | Labelled as arriving with the calendar, rather than shipped as a filter that cannot filter. |
| Reviews on the profile | Rating and count are shown; the breakdown bar and review list are Phase 5. |
| Messaging, LiveKit, notifications | Schema only. Phases 4, 5 and 7. |
| Rate limiting | Real, but in-memory, so it is per instance. Needs a shared store before more than one node. |

---

## Commands to run

```bash
pnpm install
cp .env.example .env.local     # DATABASE_URL, AUTH_SECRET, PAYOUT_ENCRYPTION_KEY, CRON_SECRET

pnpm db:migrate
pnpm seed                      # needs ffmpeg for intro videos; says so if absent

pnpm typecheck && pnpm test && pnpm build
pnpm rank                      # the nightly ranking job
pnpm reconcile                 # the nightly ledger check

pnpm dev                       # http://localhost:3000
pnpm e2e                       # reseeds, then drives the UI
```

`pnpm seed` needs `ffmpeg` and `ffprobe` on the PATH to build intro videos
(`apt install ffmpeg`, or Homebrew). Without them it seeds everything else and
says the videos were skipped.

### Last full run

```
pnpm typecheck   clean
pnpm test        22 files, 303 tests passed
pnpm build       compiled, 18 routes
pnpm seed        58 users · 40 verified · 5 pending · 1 draft · 1 rejected
                 4 transcoded clips (HLS + preview + 3 thumbnails each)
                 73 credential PDFs · 1,444 ledger entries · zero drift
                 Ranked 40 verified tutors: top 8666, median 7421
pnpm e2e         18 passed
pnpm reconcile   Ledger reconciled: 1444 entries, zero drift.
```
