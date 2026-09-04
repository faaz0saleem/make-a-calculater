# Progress

Phases follow `SPEC.md` §15.

| Phase | Status |
|---|---|
| 0 — repo, schema, migrations, auth, seed | **Done** |
| 1 — tutor onboarding wizard + admin verification queue | **Done** |
| 2 — discovery feed, search, filters, tutor profile | **Done** |
| 3A — availability engine | **Done** |
| 3B — credits and booking | **Not started** — see the note below |
| 4 — LiveKit calls + session state machine + settlement | **Done** |
| 5 — trials, messaging, reviews, follows | **Done** |
| 6 — payouts + admin dashboard + audit log | Not started |
| 7 — real payment provider, notifications, SEO, analytics | Not started |

---

## Phase 5 — done

### Free trials

A trial is a booking with `is_trial = true`, priced at zero, with no escrow row
and no ledger entries. It holds the tutor's calendar, so it goes through the
same availability engine and the same partial unique index as a paid session,
asking for its own length plus the five-minute buffer SPEC.md §6 names — which
is what lets a 15-minute trial sit in a gap an hour-long session could not.

**One per pair, for life, is the database's job.** `one_trial_per_pair` was
already in the Phase 0 schema; `requestTrial` catches the constraint violation
and turns it into a sentence rather than a 500. The guards that produce a decent
error message first — three outstanding, five a week, the tutor's own cap — are
pure, in `src/lib/trials/rules.ts`, with sixteen tests.

**Expiry is read-time.** Twelve hours after the request or two hours before the
slot, whichever comes first. Every read of pending requests clears the dead ones
first, so the counts a student is judged by are never inflated by requests that
timed out overnight, and a tutor cannot accept from a stale tab. Each expiry
goes through `transitionBooking` one row at a time: a bulk `UPDATE` would have
been the only status write in the codebase that skipped the state machine.

**The conversion moment** is the loudest thing on the screen when a trial ends —
the tutor's next three genuinely free hours from the Phase 3 engine, above the
"session ended" text rather than below it. It also waits on the dashboard for a
week, because people close tabs, and disappears as soon as they book a paid
session with that tutor.

### Messaging

No cold DMs: a thread is created by a booking or a trial request and by nothing
else. Bodies are masked **on write** — emails (including `name (at) gmail dot
com`), phone numbers however they are punctuated, messaging-app handles, and
wa.me / t.me style links. Ordinary links are left alone, because this is a
marketplace for teaching and blanket link-stripping would break the teaching.

The masker is honest about its limits: a number spelled out in words gets
through, and there is a test that says so. That is why `body_raw` exists, and
why exactly one module reads it — `src/db/moderation.ts`, which demands an admin
inside the function rather than at the route, so a future route cannot forget.
`e2e/social.spec.ts` sends a message with a phone number and an email, then
loads the thread as the tutor and asserts neither appears anywhere in the HTML.

Attachments up to 25 MB take the Phase 2 direct-upload path into the private
bucket; `/api/files` now authorises them by thread membership.

### Response time, and the two ranking terms that read nothing before

`response_median_seconds` had been a column nothing wrote since Phase 0, which
meant the "Responds in <1h" badge never appeared and the `response_speed` term
scored every tutor at the neutral midpoint. It is now computed from real
messages: the median gap between a student writing and the tutor's first reply,
with a burst of messages counting as one wait and a burst of replies as one
answer. Silence past a day counts as a reply at the ceiling — otherwise ignoring
somebody would score better than answering slowly.

`trial_to_paid_rate` had the same problem from the other end: the query was
right, but no trial had ever been taken. The seed now plants trials that
happened, two in three of which led to a paid session with the same tutor.

After both: **27 of 41 ranked tutors have a real response-speed score and 17 a
real trial-conversion score**, against zero before. `runNightlyRanking` refreshes
the medians and then scores, in one function, so a new caller cannot rank
against a week-old median.

### Reviews

Only from a student, only on a paid session that actually happened. "Actually
happened" is now a fact rather than an inference: `bookings.completed_at` is
stamped when LiveKit says the room emptied and `classifyOutcome` — the same pure
classifier settlement uses — agrees both people were there for at least half the
booked time. Settlement stamps it too, for a session nobody closed at the time.
That also fixed something quieter: a booking used to read "in progress" for the
whole day between the lesson ending and the money moving.

The displayed rating is the Bayesian average imported from the ranking module,
not re-derived, so the number on a profile and the ordering of the feed cannot
disagree. The raw distribution sits beside it as a breakdown bar. An admin can
hide a review with a reason; that writes an `admin_audit` row and takes the
review out of both the profile and the rating.

### Follows

A follow is one row. When a tutor publishes genuinely *more* time — a wider
weekly schedule, or a one-off extra window — their followers get an in-app
notification. A shuffled week is not news, so the weekly save compares published
minutes before and after; only an increase notifies. One notification per tutor
per day per follower, held by a unique index on the dedupe key.

The `notifications` table is new and not in SPEC.md §12 — see DECISIONS_NEEDED.md
item 5. Email templates are Phase 7; these rows are what they will read.

### What the tests prove

`e2e/social.spec.ts`, ten cases, is the phase's acceptance line: a trial
requested from the profile, accepted by the tutor, with the booking asserted at
zero credits and zero ledger rows; a second trial with the same tutor refused
before the student can ask for it; the conversion CTA with three real slots; the
masking round trip from both sides; a non-participant getting a 404; a review
written, shown on the profile, hidden by an admin with an audit row; and a
follower hearing about new hours.

Lighthouse on the built app: feed **99 / 100**, tutor profile **98 / 100**,
dashboard **98 / 100**, messages **99 / 100**, one conversation **99 / 100**,
notifications **98 / 100** (performance / accessibility). Getting the profile
back to 100 meant giving the star rating `role="img"` — without a role a screen
reader is required to ignore `aria-label`, so the rating was five unlabelled
glyphs — and adding a real `--warning` token instead of a hard-coded fallback.
The 360px suite now covers the conversation list and a thread.

### One test moved, and why

`the verified tutor is now in the feed` used to assert a newly verified tutor
appeared in the first screen of the ranked grid. With response speed and trial
conversion carrying real numbers, proven tutors now score above the neutral
midpoint and a brand-new one sits 26th of 41 — one scroll into an infinite feed
rather than on its first screen. That is the ranking working, not breaking, so
the test now asserts what SPEC.md §4 actually promises: the exploration slot.
It checks the **New tutors** rail, and that the tutor is genuinely in
`tutor_ranking` rather than only in a rail.

### Still owed

Phase 3 checkpoint B. There is no `PaymentProvider`, no credit purchase, and no
paid booking creation — so the conversion screen's call to action opens the
tutor's calendar instead of taking payment, and says so rather than pretending.
Trials proved out the booking-creation path (availability check, partial unique
index, state machine); what is missing is the money half.

---

## Phase 4 — done

### First, a gap you should know about

**Phase 3 checkpoint B was never built.** There is no `PaymentProvider`, no
credit purchase, and no student-facing booking creation. Bookings exist only
because `src/db/seed.ts` writes them, funding their escrow through the same
ledger the product uses.

Phase 4 did not need it: a session is a booking that already exists, and every
Phase 4 test drives seeded bookings that carry real escrow. But nothing here
proves the *creation* path — the serializable transaction, the slot hold, the
price snapshot at booking time. That is still owed.

### The classroom

`/sessions/[bookingId]`, in `src/components/classroom/`. Authorisation and every
fact about the session are resolved on the server; the browser is handed a
booking id and gets a token minted from the row, never one it could ask for
itself. A non-participant gets a **404**, not a 403.

Timing all comes from `src/lib/sessions/window.ts`, derived from the scheduled
start: the room opens five minutes early, stays open ten minutes past the end,
and billing stops at the booked end however long the room stays up.

### Attendance, and why it is the whole phase

`src/lib/sessions/attendance.ts` folds LiveKit's webhooks into the `Attendance`
shape `resolveBookingOutcome` already took. It is the only source of who was
present, and it is written for how mobile connections actually fail:

- reconnects are summed, not counted as separate short sessions
- a browser that dies without sending a leave is closed at `room_finished`, or
  at now, or at the booked end — whichever comes first
- early joins and the grace period are clamped out, so nobody is paid for them
- duplicate joins and out-of-order events do not double-count

Twenty-six tests, including "a student on a bad mobile connection" who drops
twice, rejoins twice, and still completes the lesson.

### Settlement

`src/db/settlement.ts` and `pnpm settle`. It loads the events, calls
`summariseAttendance`, calls `resolveBookingOutcome`, and appends the entries in
one transaction. **There is no money logic in it** — no percentage, no
commission arithmetic, nothing that could disagree with Phase 0. Re-running is a
no-op twice over: the ledger's idempotency keys reject the replay and
`settled_at` takes the booking out of the query.

It runs hourly on Vercel Cron rather than nightly, so a session that ended at
09:05 settles about twenty-four hours later rather than at whatever hour a
nightly job happens to run.

### The network the market is actually on

- **Pre-call check** (`src/lib/sessions/connection.ts`): times a real download
  from our own origin, with a three-second budget so a weak line is not punished
  with a long wait, and blocks a join below 150 kbps — saying, in the same
  sentence, that nobody has been charged. 300ms and 5% loss are tolerated, not
  refused; that is normal here, not broken.
- **The clock survives a reconnect** because there is no timer to restart: it
  counts from the scheduled start, corrected for device clock skew.
- **An explicit "Reconnecting…" panel**, never a frozen frame. When LiveKit gives
  up entirely, the screen says so and offers the room back rather than claiming
  the lesson ended.
- **Automatic downgrade to audio-only** when the link turns poor
  (`src/lib/sessions/degrade.ts`), with a sentence saying why, and only once —
  turning your camera back on is your decision, not something to be overruled.

### What the tests actually do

`e2e/session.spec.ts` launches two real browsers with synthetic camera and
microphone, throttles both to 300ms / 1.5 Mbps, and runs a real call through a
real LiveKit server. It then takes the student **offline** mid-session, waits for
the reconnecting panel, brings them back, and asserts the clock did not rewind.
Both leave; the webhooks land; a day later (`pnpm settle --at …`) the booking
settles and the ledger is asserted to the cent.

A second case posts a genuinely signed webhook script describing a full attended
hour — with a two-minute drop in the middle — replays every event to prove a
redelivery counts once, and asserts the completed split: no refund, tutor 80%,
platform 20%, and `pnpm reconcile` reporting zero drift.

An unsigned webhook is refused with a 401.

**What the tests do not do.** Chromium's throttling covers everything through
the network stack — the page, the token request, the signalling WebSocket the
call is negotiated and recovered over — but not the media transport, which here
is UDP to 127.0.0.1. This kernel has no `netem` to shape that with. So the
`poor → audio-only` transition is proven by unit test rather than end to end;
what a genuinely lossy media path does to a call is not something this sandbox
can show.

### The bug the tests found

`findBookingsAwaitingSettlement` passed a JavaScript `Date` into a raw SQL
fragment. Postgres had no column to infer the type from and the driver refused
it — so the settlement job threw on every run. Nothing before Phase 4 had ever
called it. It now goes in as an ISO string.

### The quality bar

- Lighthouse, on the built app: feed **99 / 100**, tutor profile **99 / 100**,
  student dashboard **99 / 100**, classroom **96 / 100** (performance /
  accessibility). Getting there meant darkening `--success` so white text on it
  clears 4.5:1, giving card titles real heading levels instead of a page full of
  `h3`s under an `h1`, and taking the big money figures *out* of headings — an
  amount is a value, not a section title.
- `e2e/mobile.spec.ts` holds the line at 360px: no page may scroll sideways, the
  pre-call button must be thumb-sized, and the classroom must be reachable by
  Tab with a visible focus ring. It found the signed-in header overflowing and
  the subject-chip rail bleeding 8px past the viewport; both are fixed. The live
  classroom is checked at 360px too, mid-call, inside the two-browser test.
- Every money-moving row on the dashboard now states its consequence before the
  fact: "This starts in under 2 hours, so cancelling now refunds nothing — you
  would lose all $8.00."

### Seed additions

Two fixtures between the demo student and tutor: a session **running right now**,
so the classroom opens without waiting, and one that **finished 26 hours ago and
has not settled**, so `pnpm settle` has something real to do.

---

## Phase 3, checkpoint A — done

### The availability engine (SPEC.md §5)

`src/lib/availability/engine.ts` is pure: rules → exceptions → minus busy →
slots → limits. `src/lib/availability/database.ts` is the part that talks to
Postgres and runs it.

The thing that makes it correct rather than nearly-correct: a weekly rule is a
**local** fact. "Monday 17:00–21:00" means five in the afternoon where the tutor
lives, in January and in July. Expanding it by adding 7×24 hours to a UTC
instant silently shifts a New York tutor's evening by an hour twice a year, so
expansion walks calendar days in the tutor's own timezone and converts each one.

Implemented: 30-minute grid, per-tutor buffer applied on both sides of every
booking, max sessions per local day, booking horizon, minimum lead time,
one-off extra windows, blocked ranges and vacation mode (one row over a range).
A 60-minute booking needing two contiguous slots falls out of requiring the
whole duration to sit inside one free interval.

### The stub is gone

`DatabaseAvailability` replaced `StubAvailability` everywhere. Live now:
"Available today", the next-free line on cards, the "Available in the next hour"
rail, the day-and-time filter, and the `availability_density_next_7d` term of the
ranking score — which moved the median from 7421 to 8050 once it was real
numbers rather than a neutral constant.

The three-valued interface stayed, and `unknown` is now rare rather than
universal. It no longer means "not built"; it means **this tutor has published
no hours at all**, which is genuinely different from "their week is full". The
first deserves silence on a card, the second an honest "nothing free".

### The seed places bookings through the engine

Every seeded booking now comes out of the same code the product uses, so none of
them sit at a time the tutor never published. A check across all 151 confirms it.
The count fell from 222 because a real calendar constrains where sessions can go
— tutors only have so many hours.

Also seeded: 24 exceptions across the tutors — vacations, blocked afternoons and
extra windows — so the engine has something to work around.

### The DST gate

`src/lib/availability/engine.test.ts` covers the SPEC.md §16 case and the two
hard nights:

- A Karachi tutor and a New York student see the same instant as 22:00 and
  12:00 before the change, and 22:00 and 13:00 after it.
- A New York tutor's Monday evening stays at 17:00 local either side, which
  means the UTC instant moves by an hour — as it must.
- A window containing the spring-forward gap is three real hours, not four.
- A window containing the ambiguous fall-back hour is three real hours, and
  starts at the first of the two 00:30s.
- A Sunday rule produces exactly one window across spring-forward night —
  not zero, not two.

### Also in this checkpoint

**Item 13, reworked as you asked.** The pipeline produces two fixed MP4
renditions instead of an HLS ladder — a small muted one for card previews, a
larger one for the profile hero — served from R2. `hls.js` is gone. The
reasoning is in `src/lib/video/types.ts` so it is not rediscovered later.

**Signed-out visitors get their own timezone.** A small client component records
the browser's zone in a cookie; the server renders in it. Without that a
signed-out visitor would have seen UTC, which is useless.

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
| Booking | The calendar is read-only. Choosing a slot, paying with credits and the escrow debit are checkpoint B. |
| Hosted transcoding | `FfmpegVideoPipeline` works locally. A deployed environment needs ffmpeg somewhere — `DECISIONS_NEEDED.md` item 13. |
| Transcoding is inline | Fine for a 90-second clip in development; production should queue it (`SPEC.md` §14). Item 14. |
| Infinite scroll | The grid shows the first 24 with a count. Paging is a small addition once there is enough supply to need it. |
| Booking | The `Book session` button is disabled. `assertBookable` is the gate Phase 3's booking mutation calls. |
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
pnpm test        23 files, 344 tests passed
pnpm build       compiled, 18 routes
pnpm seed        58 users · 40 verified · 5 pending · 1 draft · 1 rejected
                 4 transcoded clips (preview + hero + 3 thumbnails each)
                 151 bookings, every one inside published availability
                 152 availability rules · 24 exceptions
                 1,023 ledger entries · zero drift
                 Ranked 40 verified tutors: top 9220, median 8050
                 (availability from database)
pnpm e2e         26 passed
pnpm reconcile   Ledger reconciled: zero drift.
```
