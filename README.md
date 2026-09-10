# Tutorly

A discovery-first tutoring marketplace.

Verified tutors set their own 60- and 30-minute rates. Students buy credits
($10 / $25 / $50 / $100 packs, 1 credit = $1) and spend them on booked sessions.
Every lesson happens on-platform over video or voice. Tutors can offer a short
free trial they approve by hand, and cash out by bank transfer once their
balance reaches $100.

Once two people want to keep going, they set up a **weekly series** rather than
rebooking one hour at a time — the way tuition is actually sold — and credits are
still debited one session at a time, 48 hours ahead. Sessions are attached to
**syllabus chapters**, so what was covered and what is left is a thing the
product knows, and a tutor can set and mark **homework** against them.

Browsing is meant to feel like YouTube — an infinite grid of tutor cards with
autoplaying intro videos, category rails and a "continue with your tutors" row —
not like a directory table.

[`SPEC.md`](./SPEC.md) is the source of truth for the product and the data model.
[`PROGRESS.md`](./PROGRESS.md) says what is built right now.
[`DECISIONS_NEEDED.md`](./DECISIONS_NEEDED.md) lists the questions that are
genuinely blocked on a human.
[`LAUNCH.md`](./LAUNCH.md) is the deployment gate — env, DNS, migration order
from an empty database, and a smoke test to run before opening the doors.
[`RUNBOOK.md`](./RUNBOOK.md) is what to do when something breaks, written for
2am on a phone.
[`FLOW_REVIEW.md`](./FLOW_REVIEW.md) walks every journey as a person and says
what is still wrong with each.
[`MONEY_AUDIT.md`](./MONEY_AUDIT.md) asks six questions of the paths that
cannot be wrong, and records the reasoning as well as the answer.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict |
| Database | Postgres (local, Neon or Supabase — it is plain Postgres) |
| ORM | Drizzle + drizzle-kit migrations |
| Auth | Auth.js v5 — email/password and Google |
| UI | Tailwind v4 + shadcn/ui tokens |
| Live video | LiveKit — a server you run, or LiveKit Cloud *(region undecided — `pnpm measure:regions`, run from the market)* |
| Intro video transcode | ffmpeg locally; Mux or Cloudflare Stream in production *(undecided — see DECISIONS_NEEDED.md)* |
| Storage | Cloudflare R2 — private bucket for credentials, local filesystem in dev |
| Email | Resend *(phase 7)* |
| Tests | Vitest for the pure logic, Playwright for the journeys |
| Hosting | Vercel |

Payments are deliberately not tied to a provider. Everything goes through a
`PaymentProvider` interface with a `MockProvider`; the real one drops in behind
it once chosen (DECISIONS_NEEDED.md item 1). The mock is not a bypass — it posts
the same signed webhook to the same route a real provider would.

---

## Quick start

You need Node 20.11+, pnpm, and a Postgres 16 database.

```bash
pnpm install
cp .env.example .env.local          # then fill in DATABASE_URL and the secrets
pnpm db:migrate                     # create the schema
pnpm seed                           # build the development world
pnpm dev                            # http://localhost:3000
```

Generate the two secrets with `openssl rand -base64 32` each:

```
AUTH_SECRET="..."
PAYOUT_ENCRYPTION_KEY="..."         # must decode to exactly 32 bytes
```

Google sign-in is optional. Leave `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`
empty and the button hides itself.

### Seeded accounts

Every seeded account uses the password `tutorly-dev-2026`.

| Role | Email |
|---|---|
| Admin | `admin@tutorly.test` |
| Tutor (verified, Karachi) | `tutor@tutorly.test` |
| Student (New York) | `student@tutorly.test` |
| Tutor, empty draft | `newtutor@tutorly.test` |
| Tutor, rejected with a reason | `rejected.tutor@tutorly.test` |

Five more tutors sit in the admin verification queue with documents attached, so
`/admin/verification` has something real to review.

`student@tutorly.test` and `tutor@tutorly.test` also share two sessions you can
work with straight away: **one running right now**, so the classroom opens
without waiting for a booking to come round, and **one that finished 26 hours
ago and has not settled**, so `pnpm settle` has something to do.

It also plants three standing arrangements — one a week old with a session
already paid for, one running twice a week, and one inside its seven days'
notice — each with the chapters it is for and the sentence the student wrote,
plus homework in all three of its states: set, handed in, and marked.

The seed also plants the payout boundary cases from `SPEC.md` §16:
`payout.pending@tutorly.test` has a $100.00 request waiting for an admin,
`payout.ready@tutorly.test` sits at exactly $100.00 and may request, and
`payout.short@tutorly.test` sits at $99.50 and may not.

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit`, strict |
| `pnpm test` | Vitest — money, scheduling, timezones, crypto, storage. No services needed |
| `pnpm e2e` | Reseed, then drive the real UI with Playwright |
| `pnpm db:generate` | Generate a migration from `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:reset` | Migrate, then re-seed |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm seed` | Truncate and rebuild the development world |
| `pnpm reconcile` | The nightly ledger check — exits non-zero on drift |
| `pnpm rank` | The nightly ranking job — recomputes `tutor_ranking` |
| `pnpm settle` | Release escrow on sessions past their dispute window. `--at <iso>` runs it as if it were then; `--dry-run` lists what it would touch |
| `pnpm series` | Roll recurring series forward: materialise the next four weeks, warn at T-72h, debit at T-48h, lapse what went unpaid |
| `pnpm reminders` | Send what is due — T-24h and T-1h to both sides, T-10min to the tutor — and expire trial requests nobody accepted |
| `pnpm email` | Drain the email outbox: render, send, retry, dead-letter. `--limit 200` |
| `pnpm launch:sql` | Regenerate `docs/launch/*.sql` — the packs and curriculum a production database needs |
| `pnpm prove:restore` | Dump, restore into a scratch database, check every table and the ledger, then drop it |
| `pnpm prove:booking` | Fire N parallel bookings at one slot and print the result. `--clients 4` |
| `pnpm prove:commission` | What commission a booking between two people would carry right now |
| `pnpm prove:curriculum` | Show the database refusing a class from the wrong board, and a second primary position |
| `pnpm prove:rates` | Show that a commission change reached no booking that already existed |
| `pnpm prove:payout-privacy` | Dump `payout_methods` and check nothing usable comes out |
| `pnpm measure:regions` | Median latency to each candidate media region. **Run it from the market** |

---

## Video, and what this product is not

There is exactly one kind of video in Tutorly: a tutor's **intro clip**, 30 to
90 seconds, which is marketing. Every lesson is live, one to one, over video or
voice.

There are no recorded lessons, no course content, and no library. If a change
starts pulling in that direction it is the wrong change — the product is a
marketplace for someone's time, not a catalogue of videos.

The pipeline turns one upload into two fixed MP4 renditions — a small muted one
for the card that autoplays in the feed, a larger one for the profile hero — plus
three thumbnail candidates the tutor picks from. Two files rather than an HLS
ladder is a cost decision: hosted transcoders bill per minute *delivered*, and a
feed that autoplays on hover delivers minutes in proportion to browsing rather
than to bookings. R2 charges nothing for egress. `pnpm seed` runs real clips
through the pipeline, so the development feed has real media in it.

Uploads go **straight to the bucket**, not through the app. A Server Action
caps its body at 1 MB and a Vercel function at 4.5 MB, so a video posted to us
could never arrive; the browser gets a presigned PUT (or, with no R2 configured,
a signed path to our own upload route) and only hands the server the key.

## How discovery works

The feed orders by `tutor_ranking.score`, which a nightly job writes. Nothing
computes a ranking while a page is being rendered — that is the rule the job
exists to keep. The score is the weighted sum from `SPEC.md` §4, in basis points,
in `src/lib/ranking/score.ts`.

"Available today", "Next free: …" and the "Available in the next hour" rail all
go through `src/lib/availability/`, which since Phase 3 reads the tutor's real
calendar. The port still answers three ways rather than two: `unknown` now means
*this tutor has published no hours at all*, which is genuinely different from
*their week is full*. The first deserves silence on a card, the second an honest
"nothing free" — a wrong "Next free: Today 6:30 PM" costs more trust than a
missing one.

### Signing up, and where the paywall sits

Signup asks for an email, a password, and **whether you are 18 or over** — the
only question that cannot wait, because the answer changes what we are legally
allowed to do with the account. Country and timezone are inferred from the
browser, shown, and correctable; they are never asked. Everything else arrives
where it pays the student back: the class from a dismissible prompt on the
feed, the name on the booking form, the phone at the reminder step framed as
WhatsApp reminders.

The paywall is at the **end**. Browsing, opening a profile and picking a time
all work signed out; auth is required only at the commit. A visitor who picks a
slot gets a real ten-minute hold under a guest token before they have an
account, and `/api/auth/land` claims it on the way back in — so "sign up to
book this" means the slot is still there, not that they can look for it again.
Topping up happens inline on the booking page, never as a detour.

### Paying

`src/lib/payments/catalogue.ts` is one table of methods: a card, JazzCash and
Easypaisa. Countries decide **order, not availability** — a Karachi student
sees the wallets first because most of them have no card at all, a London
student sees the card first, and both see everything. Adding a provider is an
entry in that table and its own webhook endpoint; nothing in the app branches
on a provider name. Every implementation is still a mock (item 1); the routing
is not.

### Curriculum: board, class, subject

A subject on its own is too coarse to match on. "Maths" is the same word for a
Year 9 Punjab Board student and an IB Diploma one. A curriculum position is
three fields, and a class belongs to its board — an AS Level under CBSE is not
a validation error, it is a row Postgres refuses to store, because both
declaration tables carry a composite foreign key onto
`curriculum_levels (board_id, id)`. `pnpm prove:curriculum` demonstrates it.

Matching is a **tier**, not a percentage, because the differences are
categorical:

| Tier | |
|---|---|
| 3 | Same board, class and subject |
| 2 | Same board and subject, another class |
| 1 | Same subject at the same rung, another board |
| 0 | No relationship |

The tier is a **leading sort key**, so an exact match outweighs a rating: a 4.6
tutor who teaches the student's exact syllabus ranks above a 4.9 who does not.
A weight could always be out-argued by a big enough rating gap; a key cannot.
Board sits above class because a tutor who knows the syllabus can adjust a year,
and one who knows the year but not the syllabus cannot.

Below the tier, the order is the nightly score plus a **timezone-overlap
bonus**: the nightly job writes a 24-bit mask of the UTC hours each tutor is
typically free, and the request path ANDs it with the viewer's own reasonable
study hours and counts the bits. A bitwise AND and a popcount is not computing
a ranking. If we do not know where the viewer is, the term is skipped rather
than defaulted to UTC.

The board list is **shaped by country, never filtered by it** — a student in
Lahore meets CAIE, Edexcel, Punjab and Federal first and does not scroll past
CBSE to find them. Boards and classes are seeded and then owned by admin at
`/admin/curriculum`; nothing there deletes, because a board somebody declared
against cannot simply vanish.

## How a lesson runs

The classroom is `/sessions/[bookingId]`. The room opens five minutes before the
scheduled start and stays open ten minutes past the end; billing never follows
it past the booked end. A non-participant asking for someone else's session gets
a **404**, not a 403, so the URL cannot be used to find out that a session
exists.

**The client never reports attendance.** Everything the money depends on — who
was in the room and for how long — comes from LiveKit's webhooks landing on
`/api/livekit/webhook`, which verifies the signature before writing anything and
stores LiveKit's own event id under a unique index, so a redelivery cannot
inflate what a tutor is paid. Twenty-four hours after the scheduled end,
`pnpm settle` (hourly on Vercel Cron) folds those events into an attendance
summary, hands it to the same `resolveBookingOutcome` the rest of the system
uses, and appends the ledger entries. There is no second copy of the money rules.

### Built for the connection people actually have

The market is on Pakistani and Gulf mobile networks, so the failure modes are
300ms round trips, packet loss and a handover from wifi to cellular mid-lesson.
That shapes four things:

- **A pre-call check**, before the credits are at stake. It times a real download
  from our own origin — with a three-second budget, so a slow line is not
  punished with a long wait — and says plainly when a connection is too weak,
  along with the fact that nobody has been charged.
- **The session clock counts from the scheduled start**, corrected for device
  clock skew. There is no local timer to restart, so a reconnect cannot reset it.
- **A drop shows an explicit "Reconnecting…" panel**, never a frozen last frame:
  someone talking to a still picture is worse than someone told to wait. If
  LiveKit gives up entirely, the screen says so and offers the room back rather
  than claiming the lesson ended.
- **Poor quality turns the camera off automatically** and says why. A lesson
  survives losing video; it does not survive losing audio.

`e2e/session.spec.ts` drives two real browsers into a real room over a throttled
connection, takes one of them offline mid-call, and checks it comes back with the
clock intact — then settles the booking a simulated day later and asserts the
ledger to the cent.

### Running LiveKit locally

Point the app at any LiveKit server:

```
LIVEKIT_URL="ws://localhost:7880"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="…at least 32 characters…"
```

The server needs the webhook pointed back at the app, or attendance never
arrives and every session settles as a no-show:

```yaml
webhook:
  api_key: devkey
  urls: [http://localhost:3000/api/livekit/webhook]
```

Use a recent server (1.12 or later). An old one and a current `livekit-client`
negotiate, then time out and reconnect in a loop — the call looks like it works
and quietly falls apart a few seconds in.

Without these variables the classroom refuses to start and says so, rather than
dropping a student into a room that will never connect.

## Credits and booking

**Credits are the only thing a student buys.** One credit is one dollar; the
larger packs carry a bonus. Prices live in `credit_packs` and an admin edits
them at `/admin/packs`, so a price change is a form submission rather than a
deploy — and every purchase snapshots both numbers, so changing them never
reaches a purchase already made.

Nothing in the codebase names a payment provider. Everything goes through the
`PaymentProvider` interface in `src/lib/payments/`, and the only implementation
today is a mock that settles instantly. It is deliberately not a shortcut: it
sends the browser to a page that posts a **real, signed webhook** to the same
route a real provider would, so development and the tests exercise the
production path rather than a bypass of it.

A webhook that arrives three times credits once. Two guards do that, neither of
them a check-then-act:

- the signature, verified against the raw bytes before anything is parsed
- `ledger_entries.idempotency_key`, unique, derived from the purchase

`e2e/booking.spec.ts` fires three deliveries **in parallel** and asserts one
`credit_purchases` row, one ledger entry, one lot of credits.

### Booking is one transaction

Checking the slot, debiting the credits into escrow, and inserting the booking
happen together or not at all, at `serializable` isolation. Three independent
things stop a double booking, which is deliberate:

1. `booking_no_overlap` — a partial unique index on `(tutor_id, start_at_utc)`
   over live statuses. This is the guarantee; the rest are politeness.
2. `serializable` isolation, so the read that decided the slot was free is part
   of what gets serialised.
3. The availability engine, run against the transaction's own view — not the
   pool's, which would be a read outside the isolation the whole thing exists
   to get.

Whoever loses that race gets `slot_taken`, whether Postgres said so through the
unique index (23505) or a serialization failure (40001). `pnpm prove:booking`
fires N genuinely parallel bookings at one slot and prints what happened; with
four clients, one booking and one escrow entry come out the other side.

A 60-minute session needs two contiguous free slots, which falls out of asking
the engine for 60 minutes rather than being a rule of its own.

### Commission is retention-based

A tutor pays **22%** the first time a student books them and **16%** every time
after — keeping a student is worth more to us than acquiring one, and the
pricing says so. The rate turns on one fact: a paid session between those two
that actually happened (`bookings.completed_at is not null`). A free trial does
not count, and neither does a session that is booked but has not happened yet.

`tutor_profiles.commission_bps` is still read, as a **floor**: the effective
rate is the lower of the tutor's negotiated rate and the retention rate. A rate
agreed during recruitment is a promise — "you will never pay more than this" —
and the retention discount stacks on top of it. The column is **nullable**, and
null means "nothing negotiated": it used to default to 2000, which after the
rise to 22% would silently have capped every tutor at a rate we no longer
charge.

The rates have moved twice, so a tutor's history contains 15%, 16%, 20% and 22%
sessions side by side. `/tutor/earnings` reads each row from the ledger and
prints the rate it was booked at, because recalculating at today's rate would
quietly rewrite what somebody was actually paid.

Both numbers are snapshotted onto the booking at creation. A rate change
tomorrow cannot reach a booking made today, and `e2e/booking.spec.ts` proves it
by raising a tutor's rate afterwards and re-reading the row.

### Not enough credits

Picking a slot you cannot afford puts a **ten-minute hold** on it and sends you
to buy credits — the other way round means buying credits and coming back to
find the slot gone. A hold blocks everybody except its owner, and it expires
**when it is read** (`expires_at > now()`), not when a sweeper gets round to it:
a job every five minutes leaves five minutes in which the calendar is lying.

### Moving and cancelling

A session can be moved once, more than twelve hours before it starts, and the
other side has six hours to agree — or until the proposed time arrives,
whichever comes first. The original booking stands until they do. Unanswered
requests expire on the next read, the same way trial requests do.

Cancelling settles immediately through `resolveBookingOutcome`, so the refund a
student is shown before they press the button is computed by the same function
that then moves the cents.

### When something goes wrong

Either side can **report a problem** during the 24 hours after a session. That
moves the booking to `disputed`, which needs no new code in the settlement job:
`disputed` is not one of the statuses `findBookingsAwaitingSettlement` looks
for, so the money simply stops. An admin resolves it — settle as it stands, or
refund the student — and either decision writes an `admin_audit` row with a
reason. `pnpm settle --dry-run` lists what tonight would touch without touching
it.

**A connection failure is on us.** When both people turned up and the link died,
the student is refunded in full *and* the tutor is paid their full share, out of
platform revenue. That is the one outcome that cannot be expressed as a refund
percentage — the chargeable amount is zero and the tutor is still paid — so it
is the single branch in `resolveBookingOutcome` that computes its own entries.
It is capped at two per student per 90 days, because "my connection broke" is
also the easiest free lesson to claim; past the cap the student is still made
whole and the tutor is not paid from our revenue.

## Trials, messages, reviews and follows

**A free trial** is a booking with `is_trial = true`, priced at zero, with no
escrow row and no ledger entries — nothing about it touches money. It does hold
the tutor's calendar, so it goes through the same availability engine and the
same partial unique index as a paid session, asking for its own length plus a
five-minute buffer.

One trial per student–tutor pair, for life, is a **partial unique index** on
`(student_id, tutor_id) where is_trial` — not a check in application code, which
would lose the race between two clicks. The other guards (three outstanding
requests, five a week across all tutors, the tutor's own weekly cap) live in
`src/lib/trials/rules.ts`, where they can be read in one place.

A request dies twelve hours after it was made or two hours before the slot,
whichever comes first, and **expiry is checked when a request is read** rather
than by a sweeper: a job that runs every five minutes leaves five minutes in
which a tutor can accept something that should already be dead. Each expiry goes
through the booking state machine, one row at a time — a bulk `UPDATE` would be
faster and would also be the only place in the codebase that writes a status
without it.

When a trial ends, the conversion screen is the loudest thing on the page: the
tutor's next three genuinely free hours, from the availability engine. It also
waits on the dashboard for a week afterwards, because people close tabs — and
disappears the moment they book, so it never nags somebody who already said yes.

**Messages** exist only between two people who already have a booking or a trial
request. There is no way to start a conversation with a stranger, which removes
most of the spam surface before it exists.

Bodies are **masked on write**. Emails, phone numbers, messaging-app handles and
links to WhatsApp or Telegram are replaced with `[hidden]` before the row is
stored, and the readable column is the only one any student- or tutor-facing
query selects. The raw text is kept in `body_raw` for moderation, read in
exactly one place — `src/db/moderation.ts`, which demands an admin — because a
pattern cannot catch a number spelled out in words, and a human reviewing a
report needs to see what was actually sent. `e2e/social.spec.ts` proves the raw
text is not reachable from the other side of the conversation.

Attachments (25 MB) take the direct-upload path to the private bucket, and reads
go through `/api/files`, which re-checks that the viewer is one of the two
people in the thread.

**Response time** is computed from those messages: the median gap between a
student writing and the tutor's first reply. Silence past a day counts as a
reply at the ceiling — otherwise ignoring somebody entirely would score better
than answering slowly. It feeds the `response_speed` term of the ranking and the
"Responds in <1h" badge, both of which read a stored column rather than
computing anything in a request.

**Reviews** come only from a student on a paid session that actually happened —
`bookings.completed_at`, stamped when LiveKit says the room emptied and both
people were there for at least half the booked time. Trials cannot be reviewed.
One per booking, editable for seven days, one public tutor reply. The number on
a profile is the Bayesian average (m = 4.3, C = 5), the same function the
ranking uses, with the raw distribution shown beside it as a breakdown bar. An
admin can hide one with a reason, which writes an `admin_audit` row and removes
it from both the profile and the rating.

**Follows** are the retention loop: when a tutor publishes genuinely more time —
a wider weekly schedule, or a one-off extra window — their followers get an
in-app notification, deduplicated to one per tutor per day so a tutor saving
their calendar four times before breakfast is still one piece of news.

## The month, not the hour

A tutor in Lahore quotes **50,000 PKR a month for three sessions a week across
two subjects** — about $13.70 an hour, but nobody in that conversation says
"hour". What is being sold is a standing commitment: the same two evenings,
every week, until exams. Single bookings are how this codebase started and they
are still how a stranger tries somebody out. They are not how the relationship
that follows is bought.

### A series is the commitment; the ledger is still per session

`recurring_series` holds one row per standing arrangement: a tutor, a subject at
a curriculum position, one or more weekdays, a local start time, a duration, and
either an end date or an open-ended run. The price is snapshotted at creation
the way a booking's is, so a tutor raising their rate does not reprice a series
somebody is already halfway through.

The chapters come with it. A standing arrangement holds its own topic list and
its own note (`series_topics`, `recurring_series.topic_note`), and each
occurrence is stamped with both as it is created — so a tutor opening next
Tuesday reads what these Tuesdays are for without going to look for the series.

What the series does **not** do is take a month's money. A cron (`pnpm series`)
materialises **four weeks ahead**, rolling forward weekly — never an infinite
future of rows, and never a horizon so short that a student cannot see their own
month. Each occurrence is an ordinary `bookings` row in a new `scheduled` status:
it holds the slot, it appears on both calendars, and it has not been paid for.

Then each occurrence pays for itself on its own clock:

| When | What happens |
| --- | --- |
| T-72h | A warning, in-app and on the dashboard: this is what is about to be debited |
| T-48h | Credits are debited and the booking becomes `confirmed` |
| T-48h, empty wallet | The occurrence **lapses** and the slot is released |

`lapsed` is a terminal status of its own, deliberately not folded into
`cancelled_by_student`. Nobody cancelled it. It is the visible consequence of an
empty wallet, and a tutor looking at a gap in their week is entitled to know
which of those two things happened. The job also sweeps `scheduled` occurrences
that are already in the past — if the cron stops for a day, those rows lapse on
the next run rather than sitting there pretending to be a lesson.

One thing the four-week check deliberately forgives: an occurrence inside the
**tutor's own notice period**. Somebody setting up a Tuesday slot on a Tuesday
afternoon is agreeing to every Tuesday from here, and that this evening is too
short notice for this particular tutor is not a reason to refuse the
arrangement — that occurrence is skipped and the series starts next week. A
week that clashes with somebody else's booking is a different thing, and is
refused by name.

### One occurrence is not the series

Cancelling next Tuesday cancels next Tuesday. The series keeps its slot, keeps
materialising, and picks up the following Tuesday as if nothing happened —
`bookings.series_id` and a `one_booking_per_occurrence` unique index on
`(series_id, occurrence_date)` mean an occurrence can be removed, or replaced by
a rescheduled one, without touching the parent. Ending the arrangement itself is
a separate act, available to **either** side with **seven days' notice**, which
moves the series to `ending`: already-paid occurrences inside the notice window
still happen, and nothing new is materialised past it.

### The slot is reserved beyond the horizon

A four-week materialisation horizon would otherwise mean a stranger could book
your standing Tuesday in week six. `seriesBusy()` projects every active series
forward from its own recurrence rule when availability is computed, so the slot
is unavailable to one-off bookings for as long as the series runs — whether or
not a row exists yet. Occurrence maths walks **local dates** rather than adding
24 hours, anchored to the tutor's timezone, so a series survives a DST change in
either direction without drifting an hour.

### Commission counts occurrences, not questions

Commission is retention-based: 22% the first time two people transact, 16% every
time after. Asking the database "has this student paid this tutor before?" at
materialisation time answers *no* for all four occurrences created in the same
batch, which would charge the opening rate four times for what is plainly one
relationship. `commissionForOccurrence(index, hasPaidThisTutorBefore, negotiated)`
takes the index instead: **every session after the first in a series is a
rebooking**, regardless of when the rows were written. The negotiated floor still
applies — the effective rate is the lower of the two.

The offer to make it standing appears after a student's **second completed
session** with the same tutor, on the dashboard and on the tutor's page. Not the
first: one good lesson is not yet a decision.

## Chapters, and what actually gets taught

A subject is too coarse to match on and far too coarse to remember. `topics` is a
taxonomy per `(board, class, subject)` — 105 real Cambridge chapters across
maths, physics, chemistry and biology at IGCSE, O Level, AS and A2 — seeded for
the launch board and editable by an admin at `/admin/curriculum`.

Topics show up four times, and the fourth is the point:

1. **At booking**, the student picks chapters and can add free text. A tutor
   accepting a trial sees it *before* they accept.
2. **Before the session**, on the tutor's own session page, so preparation is
   possible.
3. **Afterwards**, the tutor marks which topics were actually covered and,
   optionally, how well the student grasped each one.
4. **In `/progress/[tutorId]`**, per student–tutor pair: what has been covered,
   what was shaky, what is left. This is the retention engine. A student who can
   see nine chapters behind them and four ahead is looking at a reason to stay.

Topic strength is also a **tiebreak within the exact-match tier** of search
ranking, never a tier of its own, and capped at `TOPIC_MAX_BPS = 200` — set
deliberately below the ~225 points that separate a 4.6-rated tutor from a
4.9-rated one. Chapter overlap should break a tie between comparable tutors. It
should not outrank being better.

## Turning up

The failure mode of online tutoring is not bad teaching. It is an empty room.

**A calendar invite at booking does more than any reminder we could send.**
`/api/bookings/[bookingId]/calendar` serves a real `.ics` with a stable
`UID:booking-<id>@tutorly` and a `SEQUENCE` driven by `reschedule_count`, so a
moved session updates the event already in somebody's calendar instead of
creating a second one. A Google Calendar link sits next to it for people who
live in a browser.

Then reminders, from `pnpm reminders`:

- **T-24h**, both sides.
- **T-1h**, both sides — in-app, and by WhatsApp where a number exists.
- **T-10min**, the tutor only, and worded more firmly. The professional should
  be there first.

**When one person is in the room and the other is not**, at T+2min the absent
one gets an urgent push that names who is waiting, and the person who did turn
up gets a live countdown that states exactly what happens when it reaches zero
and who gets paid. That countdown derives its deadline from
`NO_SHOW_WAIT_SECONDS` — the same constant settlement uses — and counts from
when waiting actually began, so the screen cannot tell you a different story
from the ledger.

**Timezone drift** is shown, not assumed: when the two sides are in different
zones, both are rendered, because a tutor in Karachi and a student in London
disagree about what "7pm" means twice a year.

A tutor who does not turn up is handled in rungs: the student is refunded, the
tutor's ranking takes a penalty (`RELIABILITY_MAX_PENALTY = 1500`, larger than
any subject-overlap bonus can offset), and after **two** no-shows they lose
instant booking and their requests go back to manual acceptance. There is no
removal rung here. That is a human decision.

WhatsApp goes through the same shape as payments: an `OutboundProvider`
interface with a mock implementation that deduplicates on an idempotency key.
The provider is not real yet. The routing, the dedupe and the audience rules
are.

## Homework

A tutor assigns work against a topic; the student submits a file or a block of
text; the tutor marks it with feedback (required) and a mark (optional). A
resubmission clears the previous mark, because marking work that has since been
replaced is worse than not marking it. Attachments go through the same
presigned-upload and `/api/files` proxy path as everything else.

This is the strongest anti-disintermediation feature in the product, and not
because it is locked down — it is not. It is because it is **value that only
exists here**. Two people who take the relationship to WhatsApp keep the
lessons and lose the record of what was taught, what was set, and what came
back marked.

## Notifications, and what actually sends

Fourteen kinds of email, one outbox, and a job that sends it. Nothing is sent
inline: `enqueueEmail` writes a row and `pnpm email` delivers it. Three reasons,
in the order they cost you:

1. A send that fails inside a booking transaction either rolls back a lesson
   over an email, or is swallowed. Both are wrong.
2. **A reminder that silently failed is a no-show.** A row with five attempts and
   a last error is something an admin can see; a caught exception is not.
3. Retrying needs somewhere to remember it is retrying.

The row stores *what happened* rather than a rendered document, so a fix to a
template reaches mail that is already queued. Retries back off with jitter and
give up after five attempts into dead letters, which `/admin/alerts` shows and
can requeue. Every message carries an expiry: a T-1h reminder finally delivered
after the lesson would tell somebody to join a session that already ended, so it
dies in the queue instead and the row says so.

**Seven kinds can be switched off and seven cannot.** The line is not
importance — it is whether the message is part of a transaction you are already
in. You cannot unsubscribe from being told your payout was sent, that your
credential review was rejected, or that a lesson you paid for was cancelled.
`/settings/email` lists the second group and says why, rather than showing a
switch that does nothing.

Unsubscribing works in one tap with no session: an HMAC token per kind, plus
`List-Unsubscribe` one-click so a mail client draws its own button instead of a
"report spam" one. One link per kind, because somebody tired of hearing that a
tutor they follow opened time is not asking to stop hearing that their lesson
starts in an hour.

Resend sits behind an `EmailProvider` interface — `fetch` and a bearer token,
not an SDK — and the mock records instead of sending. With no `RESEND_API_KEY`
the app queues and delivers nothing, which is right for a preview deployment and
a disaster in production, so `/api/health` reports which one you are on.

### Delivering to an inbox, not a spam folder

Three DNS records before you send anything, all in [`LAUNCH.md`](./LAUNCH.md):
SPF (`v=spf1 include:_spf.resend.com ~all`), DKIM (a CNAME Resend gives you) and
DMARC (start at `p=none`, read the reports, then tighten). A domain's sending
reputation is far easier to protect than to repair.

## When there are only three tutors

The seeded world has forty. Launch has three, and every surface that assumes
depth looks broken on day one — rails that are the grid again under a different
heading, category chips that lead nowhere, a filter panel taller than its own
results.

So the shape of the feed is a function of how much is in it
(`lib/discovery/inventory.ts`, pure and tested):

- **Under eight tutors, no rails.** A rail drawn from three is not a selection.
- **Under six, the grid says so**: "3 tutors so far. We verify every one by hand
  before they appear here." A small roster is a vetted roster, and the honest
  framing is also the attractive one.
- **Chips come from subjects that have a bookable tutor**, not from every
  subject the catalogue defines.
- **With none at all**, the feed says no tutors are listed yet and offers the two
  things worth doing — rather than telling somebody to clear filters they never
  set.

A curriculum search that finds nothing is **recorded and answered**: the position
goes into `curriculum_interest` (anonymously when the visitor is signed out,
which at launch is most of them), and the page offers the nearest positions that
have a real tutor behind them. The admin dashboard reads it back as the list of
who to recruit next.

### Inviting the first cohort

Nobody finds a marketplace's signup page on day one. `/admin/invite` makes a
single-use link — shown once, stored hashed — that lands a tutor on a page which
already knows their name. It skips the *document review*, because somebody
already vetted them in person, and it does not skip the wizard: subjects, rates
and hours are still theirs to fill in, since a verified profile without them is
the empty card this whole design is avoiding.

## How files work

Two buckets. `private` holds credential documents; `public` holds avatars and
intro videos. In production both are Cloudflare R2 over the S3 API; with no R2
configured the app writes to `.storage/` on disk instead, and the rest of the
codebase cannot tell the difference.

A credential document is never reachable by guessing a path. The admin review
screen mints a URL carrying an expiry and an HMAC over the key, and
`/api/files/[...key]` refuses anything without a valid, unexpired signature:

- no signature, a tampered one, or one over 60 seconds old → **403**
- valid signature, but the viewer is not an admin or the owning tutor → **404**,
  not 403, so the endpoint cannot be used to discover that a document exists

Reads are proxied through that route rather than handed out as presigned S3
URLs. It costs a hop and buys two things: the bucket hostname never reaches a
browser, and access is re-checked at the moment the file is opened — a presigned
URL stays valid even after an admin's access is revoked.

`src/app/api/files/route.test.ts` covers all of it, including the unsigned case.

## How the money works

Read this before touching anything with `_cents` in the name.

**Everything is an integer number of US cents.** No floats, no `Decimal`.
`1 credit = $1.00 = 100 cents`. Division happens only inside
`src/lib/money/cents.ts`, where the rounding rule is explicit at every call site.

**`ledger_entries` is the truth.** It is append-only. Balance columns like
`student_wallets.credits_cents` and `tutor_profiles.available_cents` are a cache
so pages do not sum a growing table, and `pnpm reconcile` asserts they still
equal the ledger. If they ever diverge it exits non-zero and says which balance,
by how much. Nothing outside `src/db/ledger.ts` may write a balance column.

**Money moves through six accounts:** `student_credits`, `escrow`,
`tutor_pending`, `tutor_available`, `platform_revenue`, `payout_locked`.
Internal transfers net to zero. Two groups are single-sided on purpose, because
value crosses the system boundary: a credit purchase brings money in, a paid
payout sends it out.

**One function decides every refund.** `resolveBookingOutcome(booking, attendance)`
takes the booking as it was priced and what actually happened, and returns the
ledger entries plus the non-money consequences. The whole cancellation table
collapses into a single number:

```
chargeable = price - refund
platform   = floor(chargeable * commission_bps / 10000)
tutor      = chargeable - platform
```

which is why "50% refund, tutor keeps 50% of their share" needs no special case.
Every row of that table has a test in `src/lib/money/outcomes.test.ts`.

**Prices are snapshotted.** `bookings.price_cents` and `bookings.commission_bps`
are copied at creation time, so a tutor raising their rate cannot reprice a
booking that already exists — and neither can a change to the commission rules.
The commission is retention-based (22% first, 16% after), floored by any rate
negotiated with that tutor; see *Credits and booking* above.

---


## Getting paid, and getting caught

### Payouts

A tutor adds an account — a **bank account** (IBAN or account number, with a
branch code where the local rails want one) or a **mobile wallet** (JazzCash or
Easypaisa). The second is not a lesser option: for a large share of tutors here
it is the only account they have, and a bank-only form would mean they cannot be
paid at all. A `check` constraint enforces which columns belong to which shape.

Every identifying number is **encrypted by the application** — AES-256-GCM,
keyed from `PAYOUT_ENCRYPTION_KEY`. Disk encryption does not protect against a
read replica, a backup, or `select *` in a support tool.

> `last4` is the only part of any of it that is ever rendered, to anybody,
> **including an admin.** Approving a transfer does not require reading the
> account it goes to, and a screen that can read it is a screen that can leak
> it. `src/db/payouts.ts` decrypts in exactly one function, `decryptForTransfer`,
> which nothing renders and nothing returns over HTTP.

`pnpm prove:payout-privacy` dumps the table inside a rolled-back transaction and
checks four things: nothing we wrote appears in the dump, every column is either
on the allow-list of readable ones or is ciphertext, nothing a tutor typed is
account-shaped, and the key still recovers the original.

The threshold is **$100**. Requesting moves the money out of `tutor_available`
and into `payout_locked` in the same transaction that writes the payout row, so
two tabs cannot both see $100 and both request it. Then
`requested → approved → processing → paid` — or `rejected`, with a reason the
tutor reads and the money back in their available balance. Marking paid takes a
**bank reference**, which appears in the tutor's own withdrawal history so they
can match it against their statement. Every decision writes an `admin_audit` row
inside the transaction that moves the money.

### The admin dashboard

`/admin` leads with the number that is easiest to fool yourself about: **credits
sold against credits consumed**. Cash taken is not revenue while the tutoring it
promises has not happened, and the gap is a liability.

Second is **unmatched demand** — every (board, class, subject) a student has
declared that no verified tutor teaches. It is the recruiting list, and each row
carries a *near tutors* count: people who teach that subject at the same stage
under a different board, and may already be able to teach it.

Also on the page: GMV, net revenue, effective take rate, payout liability,
escrow, trial-to-paid, cancellation rate by side, absorbed connection failures
against the cap, top subjects and curriculum positions, the card-against-wallet
split with fees, and **margin per pack** after provider fees and bonus credits —
costed at the blended take rate read from settled bookings rather than the
headline rate, which would flatter every row. On the seed that is about 6% for
the $5 pack against about 13% for the $25 one, and the difference is almost
entirely the fixed 50c a card costs. All the SQL lives in `src/db/metrics.ts`.

### Contact info: hints and humans, never an instant ban

Messages are masked on write (`src/lib/messaging/masking.ts`). On top of that,
`scoreContactIntent` estimates whether somebody *meant* to hand over contact
details — a different question — and returns 0-100 with the reasons behind it.

**It never blocks anything.** A maths tutor typing `question 15 on page 240` or
`x = 03` mid-lesson must not hit a wall, so the scorer dampens numbers by the
word next to them, sets the phone-shaped floor at nine digits rather than seven,
and has a test file whose first block is twelve pieces of ordinary teaching that
must score exactly zero.

- Above **25**, the composer says what will be hidden, before sending.
- Above **75**, a row lands in `contact_flags` for a person to read. That is the
  whole automatic response — the message is already sent and stays sent.

What follows is decided by a person: a **warning** they must acknowledge, then a
**restriction** on new trial requests and ranking position for 30 days, then
**human review**. No rung takes away an existing student, because banning a
tutor with fifteen regulars does not stop them teaching those fifteen — it sends
them to WhatsApp, which is the leak this is meant to close. Everything is
appealable, including the warning, and everything is logged.

Alongside it, a signal no single message can give: **pairs that went quiet** —
three settled sessions, then 45 days of silence with the student booking nobody
else. Reported per tutor as a ratio, because one quiet pair is a student who
passed their exam.

Determined evasion still wins. "My name on Instagram is my first name and my
birth year" defeats all of this and always will; the durable fix is the platform
being worth staying on.

---

## Rules the code holds itself to

These come from `SPEC.md` §13 and are not negotiable:

1. Money is integer cents. Column names end in `_cents`.
2. Every balance derives from the append-only ledger, and a job checks it.
3. All timestamps are UTC. Every user has an IANA timezone; conversion happens
   at render time only. The Karachi-tutor / New-York-student DST case is tested.
4. Payment webhooks and booking mutations carry idempotency keys with unique
   indexes. Webhooks arrive twice.
5. Authorization is server-side and by row. Nothing reads a user id or a role
   out of a request body.
6. One state machine owns `bookings.status`. No scattered status writes.
7. Credential documents live in a private bucket; payout bank details are
   encrypted by the application with AES-256-GCM, not just by the disk, and only
   the last four digits are ever rendered — to anybody, admins included.
   `pnpm prove:payout-privacy`.
8. Double-booking is impossible at the database level — a partial unique index
   on `(tutor_id, start_at_utc)` over live statuses, plus a transaction wrapping
   the slot check, the debit and the insert.
9. A class belongs to its board at the database level — a composite foreign key
   onto `curriculum_levels (board_id, id)`, so an AS Level under CBSE cannot be
   stored whatever the app does. `pnpm prove:curriculum`.
10. A price change never reaches a booking that already happened. The rate is
    snapshotted at creation, and `pnpm prove:rates` checks the ledger rather
    than the row — zero drift would not catch a wrong rewrite, because both
    sides would agree with each other.

---

## Layout

```
src/
  app/                  routes — home, auth, dashboard, tutor, admin, api
    tutor/onboarding/   the ten-step wizard and its server actions
    admin/verification/ the review queue and the approve / reject screen
    admin/curriculum/   boards and classes, seeded then owned by admin
    settings/curriculum a student's own classes
    api/files/          private objects, behind a 60-second signature
    api/uploads/        signed direct uploads (development stand-in for R2)
    api/cron/           ranking, reconciliation and settlement, on a schedule
    api/livekit/        the webhook attendance is measured from
    api/bookings/       the .ics a session is added to a calendar with
    api/unsubscribe/    one-click unsubscribe, the machine-readable half
    api/health/         four dependencies, checked for real
    credits/            buying credits, and the mock provider's checkout
    messages/           conversations, masked on write
    notifications/      the in-app bell
    sessions/           the classroom
    progress/           what a student and one tutor have covered
    homework/           set, submitted, marked — both sides have a view
    admin/alerts/       the screen to open before the numbers
    admin/invite/       single-use links for the first cohort
    settings/email/     what we may email you about, and what always arrives
    invite/             where an invited tutor lands
    unsubscribe/        one tap, no session
    (legal)/            five policy drafts, noindex, marked DRAFT
    (marketing)/        welcome, teach, pricing
    (seo)/              six editorial search pages, robots and sitemap
  auth.ts               Auth.js: credentials + Google, Node runtime
  auth.config.ts        the edge-safe half, used by middleware
  components/           UI primitives and the wizard's step forms
  db/
    schema.ts           the whole schema from SPEC.md §12
    ledger.ts           the only writer of balance columns; reconciliation
    curriculum.ts       boards, classes, and who declares what
    discovery.ts        the feed, search, filters and the rails
    ranking.ts          the nightly ranking job
    bookings.ts         creating, moving and cancelling, in one transaction
    series.ts           recurring series: create, materialise, charge, end
    topics.ts           what was asked for, what was covered, and progress
    homework.ts         assign, submit, mark
    reminders.ts        what is due to be sent, and the absent-party nudge
    email.ts            the outbox: enqueue, preferences, dead letters
    email-queue.ts      the half that renders and sends
    email-events.ts     one function per thing worth an email
    alerts.ts           what is going wrong right now
    demand.ts           what people asked for and could not book
    invites.ts          hand-recruiting a tutor
    disputes.ts         reporting a problem, and the settlement freeze
    moderation.ts       the only reader of raw message bodies
    purchases.ts        credit packs, checkout, and the idempotent webhook
    retention.ts        dropping raw webhook bodies after 90 days
    trials.ts           free-trial requests and the tutor's answer
    tutors.ts           every query that decides who is visible
    seed.ts             the development world
    seed-assets.ts      generated PNGs and PDFs, so no binaries are committed
    migrate.ts
  lib/
    admin/audit.ts      the admin_audit writer
    auth/               password policy, roles, server-side guards
    bookings/           the state machine, slot holds, reschedule rules
    series/             DST-safe occurrence maths, and the series rules
    calendar/           .ics generation and the Google Calendar link
    email/              the provider interface, Resend, retries, unsubscribe
    discovery/          what the feed looks like when there is little in it
    observability/      structured logs and the correlation id
    cron/               the one check every scheduled endpoint makes
    seo/                canonical URLs, robots, sitemap, structured data
    availability/       the scheduling engine, and the port discovery reads
    curriculum/         boards, match tiers, and the credential-relevance flag
    geo/                a timezone-to-country guess, used only to order a list
    livekit/            room names and access tokens
    messaging/          contact-info masking, response-time medians
    messaging/out/      the OutboundProvider interface (WhatsApp) and its mock
    reviews/            who may review, and what the stars add up to
    sessions/           the session window, attendance, connection grading
    trials/             the free-trial rules and their abuse guards
    money/              cents, pricing, commission, outcomes, ledger drafts, packs, payouts
    payments/           the PaymentProvider interface and the mock
    ranking/            the §4 score and the timezone-overlap term, pure and tested
    storage/            object stores, keys, signed URLs, direct uploads
    tutors/             profile status machine, wizard model, visibility, badges
    video/              intro-video pipeline: probe, renditions, thumbnails
    crypto.ts           AES-256-GCM for payout details
    time.ts             IANA timezone conversion
    rate-limit.ts
  emails/               fourteen templates, props-only, HTML and plain text
content/                legal and editorial copy, as data
docs/launch/            generated SQL a production database needs
e2e/                    Playwright journeys
drizzle/                generated SQL migrations
```

Unit tests sit next to what they test, as `*.test.ts`. They are pure and need no
database, so `pnpm test` runs anywhere. The journeys in `e2e/` need a database
and a built app, and run with `pnpm e2e`.
