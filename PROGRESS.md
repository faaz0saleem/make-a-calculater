# Progress

Phases follow `SPEC.md` §15.

| Phase | Status |
|---|---|
| 0 — repo, schema, migrations, auth, seed | **Done** |
| 1 — tutor onboarding wizard + admin verification queue | **Done** |
| 2 — discovery feed, search, filters, tutor profile | **Done** |
| 3A — availability engine | **Done** |
| 3B — credits and booking | **Done** |
| 4 — LiveKit calls + session state machine + settlement | **Done** |
| 5 — trials, messaging, reviews, follows | **Done** |
| 6A — curriculum matching | **Done** |
| 6B — student signup + the paywall moved | **Done** |
| 6C — payouts + admin dashboard + reports queue | **Done** |
| 7 — recurring bookings, topics, attendance, homework | **Done** |
| 8 — content merge, email delivery, day-one states, operations | **Done** |
| 8 — real payment provider, SEO, analytics | Not started |

---

## Phase 8 — surviving contact with real people — done

The last code phase before launch. Four things: Codex's content branch brought
in and its integration stops landed, email that actually sends, a product that
looks deliberate with three tutors in it, and the operational surface for one
person running this alone from a phone.

### Reconciling with Codex

Its work was **not** merged into main — it was an open draft PR, based on a
commit from before Phase 7. Merged here.

The boundary held completely: 47 new files, zero modifications, and nothing in
`db/`, `src/app/api/`, money, bookings, sessions, payouts or curriculum.
`CODEX_NOTES.md` names five places it stopped rather than working around, and
three of those were mine to land:

- **The public routes.** Every legal page, the sitemap and robots.txt redirected
  anonymous visitors to sign-in. `lib/auth/public-paths.ts` is now one
  allowlist, derived from the content modules rather than copied, so adding a
  policy cannot silently produce a page nobody can read.
- **The homepage intro**, for a signed-out unfiltered visit only.
- **One canonical for the feed**, with every filtered variant noindex.

It also read the money code it was forbidden to touch and flagged a real bug:
`minutesBeforeStart` floors, so a student cancelling with 24 hours and thirty
seconds' notice fell into the half-refund tier. Fixed, with the boundary pinned
from both sides.

### Email that sends

Fourteen templates existed and nothing delivered them — which is why session
reminders did not exist.

- **An outbox, not an inline send.** The row holds *what happened*; the job
  renders and sends it. A send that fails inside a booking transaction either
  rolls back a lesson over an email or is swallowed.
- **Retries with backoff and jitter, five attempts, then a dead letter** an
  admin can see and requeue. A 422 for a bad address is final; a 429 is "later".
- **Every message has an expiry.** A T-1h reminder delivered after the lesson
  tells somebody to join a session that ended.
- **Seven kinds are optional and seven are not**, and `/settings/email` says
  which and why rather than showing a switch that does nothing. One-tap
  unsubscribe with no session, per kind, plus `List-Unsubscribe` one-click.
- Resend behind the same provider-interface pattern as payments.

Two things this uncovered: rendering pulls in `react-dom/server`, which Next
refuses to have in a page's module graph — hence the runtime import and the
split between `db/email.ts` and `db/email-queue.ts`; and `tsx` needed its own
tsconfig for JSX, without which the seed logged an enqueue failure instead of
sending anything.

**Three crons did not exist.** `reminders` and `series` were scripts only, so a
production deployment would have sent no reminders and never charged a standing
session.

### Day one

I shrank the world to three tutors and looked. Everything worked; all of it said
"this place is empty" — the same three people under four headings, twelve chips
leading to nine empty pages, a filter panel taller than its results.

The feed's shape is now a function of its inventory (`lib/discovery/inventory.ts`,
pure and tested): no rails under eight tutors, the count said out loud under
six, chips built from what is actually bookable, and a real empty state instead
of "clear the filters you did not set". A curriculum search that finds nothing
is recorded — anonymously when signed out — and answered with the nearest
positions that have a tutor behind them.

`/admin/invite` makes a single-use link for hand-recruiting. It skips the
document queue and not the wizard, because a verified profile with no rates is
the empty card this phase is about.

### Operations

`/admin/alerts` is the screen to open first: ledger drift, settlement behind,
payouts stuck, sessions nobody joined, stalled payments, refund spikes, dead
letters, a queue that is not draining — each saying what to do and linking to
the runbook heading. `/api/health` checks four dependencies for real, including
a write-and-read-back against object storage. Structured logs carry a
correlation id (`booking:<id>`) through bookings, ledger, LiveKit, settlement
and email.

`RUNBOOK.md`, `LAUNCH.md` and `FLOW_REVIEW.md` are the three documents this
phase owes. The restore procedure is **proven**, not described: `pnpm
prove:restore` dumps, restores into a scratch database, checks every critical
table and that the ledger still balances, then drops it.

### What the flow review found

Eleven defects, all found by walking rather than reading — the worst being that
`/admin/alerts`, the screen built to say what is broken, returned a 500 on every
load because its query read a column that does not exist.

It also found the two things that stop a launch and are **not fixed**: there is
no password reset, and email addresses are never verified. Both are written up
in `FLOW_REVIEW.md` with what they need. Password reset is an authentication
flow and deserves to be built deliberately rather than at the end of a long
session; verification is waiting on `DECISIONS_NEEDED.md` item 6, which is a
product decision about gating.

---

## Phase 7 — the month, the syllabus, and the hour itself — done

Four things that only make sense next to each other. The market data behind all
of them is one quote: **a Lahore tutor, 50,000 PKR a month for three sessions a
week across two subjects — about $13.70 an hour.** The rate is the least
interesting part. The *structure* is the point, and it is written up as
`DECISIONS_NEEDED.md` item 32.

### Recurring bookings

"Same time every Tuesday and Thursday" is one decision, made once, because that
is the shape the market already has. A student who has decided that should not
have to decide it again every week.

The one place this deliberately does **not** copy the market is the money.
Taking 50,000 PKR up front would mean holding a month of somebody's money
against tutoring that has not happened, on a platform they have used twice. So:

- **The series is the commitment; the ledger is per session.** Each occurrence
  is charged at its own T-48h, with a warning at T-72h if the wallet will not
  cover it. Agreeing to eight sessions costs nothing today.
- **An occurrence nobody can pay for lapses, visibly.** A new terminal status,
  `lapsed`, distinct from a cancellation because nobody chose it and from
  `expired` because the tutor needs to know *why* their Tuesday disappeared. No
  money ever moved, so there is nothing to refund.
- **A `scheduled` booking holds its hour from the moment it exists.**
  `scheduled` joins `ACTIVE_BOOKING_STATUSES` and the `booking_no_overlap`
  index, so a one-off cannot walk into a standing slot.
- **And beyond the four materialised weeks, the availability engine projects the
  series forward.** Only four weeks exist as rows — rows stretching to the heat
  death of the universe are not a schedule — so without that projection a
  one-off six weeks out would take somebody's standing Tuesday.
- **Commission is decided by occurrence index, not by a database question.**
  "Every session after the first is a rebooking" cannot be implemented by asking
  "has a session completed yet?" at materialisation: four weeks are created at
  once, before any of them has happened, so asking would answer *no* eight times
  and price a month of committed work at the 22% acquisition rate. Occurrence
  one is 22%, the rest are 16%, and a negotiated floor still wins.
- **The price is snapshotted on the series**, not re-read per occurrence. A
  standing arrangement at an agreed rate is what both sides think they agreed.
- **Seven days' notice, either side.** Occurrences inside the notice period
  stand; everything after is cancelled, and since none of it was charged there
  is nothing to refund.
- **A series carries its chapters**, in `series_topics` and a note on the row,
  and each occurrence is stamped with both as it is materialised. A standing
  slot is agreed *for* something; making the tutor go and find the series to
  remember what would be the same mistake as not asking at all.
- **An occurrence inside the tutor's own notice period is skipped, not a
  clash.** Setting up a Tuesday slot on a Tuesday afternoon means every Tuesday
  from here — that this evening is too short notice for this tutor is not a
  reason to refuse the arrangement. A week taken by somebody else's booking
  still is, and the error names the dates.
- The offer appears **after a student's second completed session with a tutor** —
  the moment they are weighing it up anyway.

The occurrence maths is anchored to the **tutor's** timezone, because their
published hours are; `occurrences.test.ts` walks a series across a DST boundary
in both directions to prove the wall clock stays put.

### Topics and chapters

A booking now says what it is for. 105 real Cambridge chapters across maths,
physics, chemistry and biology at IGCSE, O Level, AS and A2 — admin-editable at
`/admin/curriculum`, retired rather than deleted so a chapter somebody has
already covered never rewrites their history.

- The student picks up to five, plus **free text** — "I don't understand
  titration calculations" — which is the more useful half and the one no
  taxonomy contains. The same picker sits on the standing-slot form, where it
  answers a longer question: what are these Tuesdays *for*.
- The tutor sees it before the session, and **before accepting a trial**, which
  is when the answer actually changes their decision.
- Afterwards the tutor marks what was **actually** covered. Nothing is
  pre-ticked: a session booked for three chapters that got through one is the
  normal case, and a form that collected a lie in one click would make the
  progress view worthless.
- `/progress/[tutorId]` shows covered against remaining, and **lists what is
  left** rather than hiding it behind a total. "Eight to go" is a statistic;
  "Electrolysis, Chemical energetics, Organic chemistry" is a reason to book
  Tuesday.
- Tutor topic strengths are a tiebreak **inside** the exact-match tier, capped
  at 200 points — deliberately below the ~225 between a 4.6 and a 4.9, so a
  chapter match cannot out-argue three tenths of a star, and never a new tier.

### Attendance

- **`.ics` and a Google Calendar link at booking.** Worth more than every
  reminder here put together: a reminder competes with every other notification
  on a phone, a calendar entry is in the thing they check to find out what their
  day is. Stable `UID` per booking and a `SEQUENCE` that rises on reschedule, so
  a moved session *replaces* the entry rather than sitting beside it — the
  failure that makes people stop adding them.
- **Reminders at T-24h and T-1h to both, T-10min to the tutor alone**, worded
  more strongly, because the tutor is being paid and the professional should be
  in the room first. It is the only reminder that names a consequence, because
  it is the only one where there is one.
- **The empty room.** Two minutes in with one person present, the absent one
  gets a push naming who is waiting, and the person present sees a live
  countdown. The countdown runs on `NO_SHOW_WAIT_SECONDS` — the same clock that
  settles the money — counted from when the waiting actually started, not from
  the hour. A screen that said fifteen while settlement used ten would be
  lying to somebody about their own money.
- **WhatsApp behind a provider interface**, the same shape as payments: a mock
  transport, but real routing, real dedupe on a client reference, and a real
  failure branch. Everything except the last HTTP call already runs.
- **Timezone drift** names both times for the next session rather than saying
  "your timezone may be wrong", and changes nothing on its own — guessing
  somebody has moved because they opened the app in an airport would be worse
  than the problem.
- **No-show escalation**: refund, then a ranking penalty from the first strike
  (1500 points at three — larger than the timezone-overlap term, because
  turning up *is* the service), then **loss of instant booking** at two. Their
  sessions stop confirming themselves; the credits still go into escrow, and an
  unanswered booking is refunded in full at the tutor's door. There is no
  removal rung: that is an admin decision about a whole record.

### Homework

Set against a chapter, off the back of a session, submitted as text or a file
through the existing presigned path, and marked. The mark is optional; the
feedback is not, because a number with nothing beside it teaches nobody
anything. Files are private and re-checked at `/api/files` against the two
people on the assignment.

This is the strongest anti-disintermediation feature in the product and it is
not a restriction — it is value that only exists here. A tutor and a student who
move to WhatsApp keep the video call and lose this.

### Two things fixed on the way

**The migrator now commits one file at a time.** Postgres refuses to *use* an
enum value in the transaction that added it, and drizzle's own `migrate()` wraps
every pending file in one transaction — so `ALTER TYPE ... ADD VALUE 'scheduled'`
followed anywhere later by an index predicate mentioning `'scheduled'` failed
with 55P04. Splitting across two files did not help while both shared a
transaction. `src/db/migrate.ts` now runs each file in its own, using drizzle's
own bookkeeping table and hash format so nothing here is a private format.

**`parseClock` rejects nonsense instead of coercing it.** A malformed time from
a form used to travel as `NaN` into `Intl.DateTimeFormat` and surface as
`RangeError: Invalid time value` three frames deep in the timezone code, with
nothing naming the field.

---

## Phase 6, part C — payouts, the dashboard, the reports queue — done

Three things that only make sense together: getting money out, seeing whether
the business works, and dealing with the people trying to take it elsewhere.

### Payouts

A tutor adds an account, asks for their money at $100, and an admin pays it with
a reference they can find on their bank statement. What is worth reading:

- **Two shapes of account, because in this market they are genuinely different
  things.** A bank account is an IBAN or an account number with a branch code; a
  mobile wallet is a phone number at JazzCash or Easypaisa, and for a great many
  tutors here it is the only account they have. A `check` constraint enforces
  the shape — a bank row must have a bank name and no wallet provider, and a
  wallet row the reverse — so neither can be half-filled.
- **Encrypted by the application, not only by the disk.** AES-256-GCM in
  `src/lib/crypto.ts`, keyed from `PAYOUT_ENCRYPTION_KEY`. Disk encryption does
  not help against a read replica, a backup, or `select *` in a support tool.
  **`last4` is the only part that is ever rendered, to anybody, including an
  admin** — the admin queue's SELECT does not list the ciphertext columns at
  all, so the screen most likely to grow a "just show me the number" field never
  has one to show.
- `pnpm prove:payout-privacy` **dumps the table and checks**, inside a
  rolled-back transaction: nothing we wrote appears in the dump, every column is
  either on the allow-list of readable ones or is ciphertext, nothing a tutor
  typed is account-shaped, and the key still recovers the original — so it is
  protected rather than lost.
- **Requesting moves the money in the same transaction.** `SELECT … FOR UPDATE`
  on the tutor's row, then the ledger entries, then the payout row. Two tabs
  cannot both see $100 and both request it.
- **`requested → approved → processing → paid`**, or `rejected` with a reason
  the tutor reads. The queue only ever offers the step that is legal next — an
  earlier draft offered "Mark paid" on an approved row and the state machine
  correctly refused it, which the e2e caught.
- Every decision writes an `admin_audit` row **inside the transaction that moves
  the money**. Rejecting returns the amount to available, because a payout that
  did not happen is money the tutor still has.

The three seeded fixtures still land exactly: `$100.00`, `$100.00`, `$99.50`.
The middle one is paid by mobile wallet.

### The earnings page

Available, pending, locked, lifetime — and then every session, **read from the
ledger rather than recomputed**. Commission has been 15%, 16%, 20% and 22%, and
a tutor scrolling their history sees all four. A page that recalculated each row
at today's rate would quietly rewrite what they were actually paid. Each row
carries and prints the rate it was booked at, and a line above the table
explains the mixture so it reads as history rather than a bug.

### The admin dashboard

Two numbers are load-bearing and everything else is context.

**The float**, first and full width: credits sold is cash taken, credits
outstanding is tutoring owed and not yet delivered. They are not the same money,
and a marketplace that reads the first as revenue eventually spends the second.

**Unmatched demand**: every (board, class, subject) a student has declared that
no verified tutor teaches. It is the only thing on the page that says what to do
next. Each row carries a **near tutors** count — people teaching that subject at
the same stage under a different board — which turns the list into two piles: a
row with several of them is a conversation, a row with none is a hire.

Also: GMV, net revenue, effective take rate, outstanding payout liability,
escrow, sessions settled, trial-to-paid, cancellation rate by side, no-shows,
absorbed connection failures against the 2-per-student-per-90-days cap, top
subjects, top curriculum positions, provider split with fees, and **margin per
pack after provider fees and bonus credits** — costed at the blended take rate
read from settled bookings, not the headline commission. On the seed that puts
the $5 first-lesson pack near 6% and Standard near 13%, and the gap is almost
entirely the fixed 50c a card costs. That is the argument for the wallets in one
row of a table.

All the SQL is in `src/db/metrics.ts`; the page arranges it and nothing else.

### The reports queue

Report a tutor, a student, a message or a session. An admin resolves with an
action and a reason **the reported person reads**, and every resolution writes
`admin_audit`. `reports` gained `resolution_action`, `resolution_reason` and
`resolved_by`, because an admin picking up a report needs to see how the last
one went without reading the audit log.

The queue resolves the *thing* reported to the *person* a notice would land on —
a message to its sender, a review to its author — so the admin does not have to.
A session report has no single subject and says so, sending them to the dispute
queue instead.

### Contact info: no instant bans

The obvious design — detect a phone number, ban the account — fails twice, and
the reasoning is written out in `DECISIONS_NEEDED.md` item 28. What is built
instead:

1. **A compose-time hint.** The draft is scored as it is typed. Above 25 it says
   what will be hidden and what is not covered off-platform. It never disables
   the button and never edits the text. Somebody who reads it and sends anyway
   has made a decision, which is a far more useful thing for a reviewer to see.
2. **Confidence, not a verdict.** `scoreContactIntent` returns 0-100 plus the
   plain-English reasons behind it. Dampening is by **adjacency**: `page 240` is
   a page, `whatsapp me on 0300 1234567` is a number, and a message with both
   has one of each. The floor for a phone-shaped run is nine digits, not seven,
   because a queue full of "do 1 2 3 4 5 6 7" is a queue nobody reads. The first
   block of `contact-intent.test.ts` is twelve pieces of ordinary teaching that
   must score exactly zero — `question 15 on page 240` and `x = 03` among them.
3. **75 and above writes a row and does nothing else.** The message is already
   sent and stays sent. `recordContactFlag` is called after the insert, outside
   anything that could undo it, and a failure to write the flag loses a
   moderation row rather than a lesson.
4. **A graduated, human-reviewed response.** Warning the person must
   acknowledge → a restriction on **new** trial requests and ranking position
   for 30 days → human review. No rung takes away an existing student, because
   banning a tutor with fifteen regulars does not stop them teaching those
   fifteen: it sends them to WhatsApp, completing the leak instead of closing
   it. Every rung is issued by a named admin who has read the message, every one
   is appealable including the warning, and all of it is logged.
5. **A behavioural signal no single message can show.** Pairs that completed
   three sessions and then went quiet for 45 days, where the student has not
   booked anyone else here — reported per tutor as a ratio, because one quiet
   pair is a student who passed their exam. Nothing acts on it.

The unacknowledged notice puts a red **Notice** button in the header until it is
read, and `/settings/notices` shows the admin's words verbatim with an appeal
box under each one.

### What the seed now carries

Five contact-info flags, and they are five *different* attempts: a phone number
and an email, a Telegram handle, an address written as "gmail dot com", a
`wa.me` link, and — the interesting one — "it would be cheaper if we did it
directly", which contains no contact details at all and which the masking layer
cannot see. Beside them, deliberately, five maths messages stuffed with page and
question numbers that produce nothing.

Three open reports. **No sanctions**, because every notice in this product is
issued by a named person who read the thing, and seeding one would be seeding a
decision nobody made.

Eight established pairs, five of which went quiet — enough for the ratio to mean
something on two different tutors (80% and 33%). They needed seeding rather than
emerging, and that is itself informative: with a shared pool of students, a pair
almost never satisfies "three sessions, then silence, and nobody else here"
by accident, which is the clause doing its job.

Two smaller corrections fell out of building the dashboard:

- **Purchases now go through the rail a student would actually use.** Every
  seeded purchase used to be `mock`, which made the provider split and the
  margin-per-pack fees a constant — and the fee is the whole argument for the
  wallets.
- **The $5 pack is now genuinely a first purchase.** The database enforces
  "once ever"; "first" is stricter and only the seed can honour it. It was being
  sold as a top-up, which put a third of all purchases on the cheapest pack.

And one that was a real hole: `pnpm reconcile` reported drift after every e2e
run, because two test helpers wrote `student_wallets.credits_cents` directly.
Credits now arrive in the tests the only way they are ever allowed to — a paid
purchase and a ledger entry — so the reconciliation job is clean after the suite
rather than expected to be wrong.

---

## Phase 6, part B — signup, and the paywall moved — done

Two halves of the same idea: **stop asking for things before they are worth
anything.** The old flow asked for a name, a country and a timezone before
showing a tutor, and asked for money before showing a price.

### Signup asks three things

An email, a password, and **are you 18 or over?** That last one is the only
question that cannot be deferred, because the answer changes what we are
legally allowed to do with the account from the first minute. Everything else
is a field, and a field can wait.

- **Country and timezone are inferred, never asked.** The browser knows both.
  The form shows what was inferred and offers a corrector behind one link,
  rather than two required selects. This is not only politeness: the timezone
  feeds the overlap term from Part A, so a student who answers nothing still
  gets tutors who are awake when they are.
- **`users.guardian_id` exists now**, nullable, alongside `guardian_email` and
  `guardian_linked_at`. Parent accounts are later; adding a self-referencing
  foreign key to `users` once bookings and ledger rows point at these accounts
  is a far worse migration than adding it while it is empty.
- **Under 18 is captured at signup and acted on at the first booking**, which
  is when it stops being hypothetical: somebody is about to meet an adult on a
  video call. The booking form asks for a guardian's email and `linkGuardian`
  refuses to write one onto an account that never said it was under 18.
- **Google carries the same answers across.** Google returns an email and a
  name; the 18-or-over answer and the inferred place ride along in a
  short-lived cookie and land in an `events.createUser` hook. It is a hint, not
  a credential — no role is ever read from it.

Nothing else is asked at signup:

| Field | Where it now arrives | Why there |
|---|---|---|
| Class | A dismissible prompt on the feed | The answer improves the feed immediately |
| Name | The booking form | The tutor is about to need it |
| Phone | "WhatsApp reminders" on the dashboard | A reminder is a thing they get, not a tax they pay |

The class prompt's "Not now" lasts a fortnight, not for ever — somebody
browsing idly in January may be looking hard in February. Once they answer it
never returns. Until a student gives a name, `users.name` holds a tidied
version of their email's local part and `name_confirmed_at` is null, so no
screen ever renders a blank and every screen knows it is a placeholder.

**Measured, not asserted.** A Playwright test counts every click, key press and
submit the browser sees and times the first browsable feed:

```
interactions  0   (a visitor presses nothing to browse)
time to feed  well under the 10s bar, on the built app
```

### The paywall moved to the end

Browse → profile → calendar → **pick a slot** all work signed out. Auth is
required at exactly one point: committing.

The hard part was not moving it. It was that a visitor who picks a time and
goes off to create an account has to come back to **that time, still held** —
otherwise "sign up to book this" means "sign up and find out". So a hold no
longer requires an account:

- `slot_holds.student_id` is nullable and `guest_token` was added, with a check
  constraint making it exactly one of the two and a partial unique index on
  each. A guest's pick is a real ten-minute hold before the account exists.
- Sign-in and sign-up both redirect through `/api/auth/land`, which claims the
  guest's holds and clears the cookie. One place, once, testable — rather than
  something every landing page has to remember.
- The commit page is `/tutors/[id]/book`: the slot, the price, the balance, the
  hold's expiry, the top-up, the name and the guardian question, all on one
  page. **The top-up is inline** — a detour to a separate credits screen is how
  a booking gets abandoned. The e2e test buys credits mid-flow and asserts the
  hold's `expires_at` is unchanged on the way back.

### Pricing

- **A $5 pack, once per person.** Two guards, because they catch different
  things: a check that refuses anybody who has bought before, and a partial
  unique index on `credit_purchases` that refuses a second one even when two
  checkouts are opened in two tabs at the same instant.
- **Bonus credits: none below $50, 3% at $50, 5% at $100.** A dollar of bonus
  is not a dollar of marketing spend — a credit is a claim on a lesson, and a
  lesson costs us the tutor's share. The test that pins this asserts the real
  number: **78c of payout per dollar given away.**
- **Commission 22% / 16%**, up from 20/15, floored by any negotiated rate
  exactly as before.

`tutor_profiles.commission_bps` had to change shape for that rise to mean
anything. It defaulted to 2000, which was a stand-in for "nothing was
negotiated" — and left as-is it would have capped every existing tutor at the
old rate and made the change a no-op. It is now **nullable, null meaning no
promise was made**; the migration moves the old default to null and leaves the
five genuinely negotiated 15% rates alone.

### Settled bookings did not move

```
$ pnpm prove:rates
176 bookings in a terminal state, by snapshotted rate:
  15%    45 (a rate we no longer charge)
  16%     7 (a rate we charge today)
  20%    80 (a rate we no longer charge)
  22%    44 (a rate we charge today)

Ran the nightly jobs: settled 1, pruned 0, ledger drift none.
OK    no terminal booking changed its price or its rate
OK    every settled booking was split at its own snapshotted rate

The rate change reached no booking that already existed.
```

Two assertions, deliberately different. The first is a fingerprint before and
after the nightly jobs. The second reads the **ledger**: for every settled
booking, the platform's share as recorded matches that booking's *own*
snapshot rather than today's constant. Zero ledger drift would not have caught
a wrong rewrite — both sides would agree with each other perfectly. This does.

The seed now spans the repricing on purpose: bookings older than thirty days
carry the rates that were in force when they were made, so the proof has
something to fail on. It also applies the retention rule properly, tracking
which student-and-tutor pairs have already had a paid session.

### Paying without a card

Many students here have no card at all, so a card-only checkout is not an
expensive checkout for them — it is a closed door. And at 5% + 50c a $5
purchase costs 75c in fees, fifteen percent of the transaction we most want
somebody to make.

`src/lib/payments/catalogue.ts` is one table: id, label, the countries it leads
in, what it costs us, and a factory. Adding a provider is an entry there and
nothing else — no branch in the checkout, no `if (country === 'PK')` anywhere
in the app. Each provider gets its own webhook endpoint, because a body must be
verified with the key of the provider that signed it.

Countries decide **order, not availability**: a Karachi student sees JazzCash
and Easypaisa first, a London student sees the card first, and both see
everything. Every implementation is still a mock; the routing is not.

### What a tutor actually earns

The rate screen now says *"You'll receive $19.50 of a $25.00 lesson from a new
student, and $21.00 once they come back."* Two numbers, because a rate is one
figure and income is two. At the $5 floor it reads $3.90 an hour, which is a
better argument against pricing there than a rule forbidding it would be.

### A bug the tests found

The trial calendar offered slots inside the two-hour request cutoff and then
refused them. It now starts the trial calendar at the cutoff, so a time that is
offered can actually be asked for.

---

## Phase 6, part A — curriculum matching — done

A subject on its own is too coarse to match on. "Maths" is the same word for a
Year 9 Punjab Board student and an IB Diploma one, and a tutor who is excellent
at one may be no use at all for the other. A curriculum position is now three
fields — **board, class, subject** — and everything about matching hangs off the
triple.

### A class only means something inside a board

`curriculum_levels` are board-scoped and their ids are namespaced
(`caie:as-level`, never a global `as-level` that half the boards would have to
pretend to understand). Both declaration tables carry a **composite foreign key**
onto `curriculum_levels (board_id, id)`, so an AS Level under CBSE is not a
validation error the app raises — it is a row Postgres refuses to store.

```
$ pnpm prove:curriculum
OK    AS Level under CBSE      refused, SQLSTATE 23503
OK    Two primary positions    refused, SQLSTATE 23505
OK    A level that does not exist refused, SQLSTATE 23503

The database refuses all three. Nothing was left behind.
```

Ten boards seeded and admin-editable: CAIE, Edexcel, Punjab, Federal (FBISE),
IB, CBSE, AQA, OCR, AP, and a catch-all "Other / not listed" that is always
present and always last. A list that cannot express where somebody actually is
teaches them the product is not for them.

### The board list is shaped by country, never filtered by it

`board_countries` decides the *order*. A student in Lahore meets CAIE, Edexcel,
Punjab Board and Federal Board first and does not scroll past CBSE to find them;
the UAE surfaces CAIE, Edexcel, IB and CBSE; the UK surfaces AQA and OCR and not
CBSE. Everything else stays on the list underneath, because "not used where you
are" is not "not available". A signed-in user's own `users.country` decides it;
a visitor's is guessed from their timezone, which can only ever cost them one
extra scroll.

### Exact match outweighs rating

The rule, in one line, and the thing most likely to be lost by a stray
`order by score desc`. The match tier is a **separate leading key**, not another
weighted term — a weight can always be out-argued by a big enough rating gap, a
key cannot.

| Tier | Meaning |
|---|---|
| 3 | Same board, same class, same subject |
| 2 | Same board and subject, another class |
| 1 | Same subject at the same stage, another board |
| 0 | No relationship |

Board sits above class deliberately: a tutor who knows the CAIE Physics syllabus
can adjust from AS to A2 in an evening; a tutor who has taught Class 11 Physics
under the Punjab Board has never seen the CAIE paper. The syllabus is the
expensive knowledge, the year is the cheap one. The catch-all board never earns
a near match — two people who both picked "not listed" have told us nothing they
have in common.

On the seeded world, signed in as the demo student and with the filter cleared —
so every non-matching tutor is present and still loses:

```
tier 3  4.65★  Hassan Raza
tier 3  4.56★  Rania Dubois
tier 2  4.30★  Sana Zhang
tier 2  4.19★  Faisal Farooq
...
tier 0  4.60★  Nadia Hassan      ← better rated than Rania, ranked below her
```

Every card says which tier it is, because the ordering is a promise: a student
who is not told why sees a 4.6 above a 4.6 and assumes the feed is broken.

### Timezone overlap

All teaching here is live, so a brilliant tutor whose evenings are 3am for this
student is not a good tutor *for them*. The nightly job writes a 24-bit mask of
the UTC hours each tutor is typically free to `tutor_ranking.free_hours_mask`;
the request path ANDs it with the viewer's own reasonable study hours and counts
the bits. **A bitwise AND and a popcount is not computing a ranking** — the
expensive half, expanding a week of rules through the availability engine, still
happens at 3am.

Worth up to 1200 basis points, which is more than the ~225 points between a 4.6
and a 4.9. Being reachable at a workable hour matters more than three tenths of
a star; teaching their syllabus matters more than either. A tutor with no
published hours scores the neutral midpoint rather than zero — the same
"unknown is not no" rule the availability port has always kept.

Half-hour offsets are handled honestly: 07:00 IST is 01:30 UTC, so both UTC
hours the local hour touches are set.

### Applied by default, visibly, clearable in one tap

A signed-in student's primary position is applied to the feed by default. That
is only fair if it is visible and reversible, so there is a banner saying
exactly what is being matched on and a link that clears it — and one that puts
it back. Both live in the URL, so they are shareable and the back button undoes
them.

Near matches are included by default and ranked below exact ones, so a niche
position never lands on an empty page. When it does anyway, the empty state
offers the two ways out rather than a dead end: relax to other boards, or see
every tutor.

A `subject` in the URL wins over the subject of the declared position: a student
who sits CAIE AS Maths and clicks the Chemistry chip means "CAIE AS Chemistry",
not "nothing" — and the banner shows them exactly that.

### Declaring it

- **Tutors** declare up to 15 positions on the subjects step. The subject picker
  only offers subjects already on their profile, and `setTutorCurriculum`
  enforces the same rule again inside a transaction, because a select is a
  suggestion and a transaction is a guarantee. The cap lives in the write path
  rather than a trigger: it is a product decision, and it belongs where the
  product decision is readable.
- **Students** get one primary position and as many more as they like. A partial
  unique index on `(student_id) where is_primary` is what makes "primary" mean
  exactly one thing. Removing the primary promotes the next one, so the feed
  always knows what to match on.
- The question arrives **inline in the feed**, never as a wall. The feed works
  before it is answered, and skipping it costs nothing. (Part B tightens this
  into the dismissible prompt and measures the time-to-feed.)

### Verification: a flag, not an auto-reject

The admin review screen says when a tutor's declared subjects have no visible
support in their uploaded documents. A physics graduate who has taught GCSE
English for a decade is a real person and a good tutor; an automatic rejection
would lose them. What an admin wants is to be told where to look.

The matching is deliberately generous — a mathematics degree supports physics,
an engineering degree supports both, and any teaching licence or PGCE supports
everything, because that is exactly what it certifies. Every rule can only
*remove* a flag.

Seeding this honestly mattered: pairing credentials and subjects at random made
the flag fire on almost every profile, which is how a real flag becomes
wallpaper. `CREDENTIAL_TEMPLATES` now carries which subjects each qualification
backs, a deliberate minority of the queue is mismatched, and an e2e test asserts
the queue is **not** a wall of flags.

### The seed migrated onto real triples

Every seeded tutor and student now has a plausible position, shaped by their
country: 220 tutor positions and 14 student positions. Two invariants are
asserted by the seed itself rather than assumed — no tutor exceeds 15, and no
position names a subject the tutor has not declared.

### What was not done here

The match tier is one correlated lookup per candidate row. The primary key
starts with `tutor_id`, so each lookup is a prefix scan over at most fifteen
rows — affordable at this size, and not at a hundred thousand tutors. The step
when it stops being affordable is to denormalise each tutor's positions onto
`tutor_ranking` as an array with a GIN index, written by the same nightly job
that writes the score. Not to move any of it into the request path.

---

## Phase 3, checkpoint B — done

The gap every earlier phase had to work around. A student can now buy credits
and book a tutor, which is what makes the rest of it real.

### Credits

`PaymentProvider` with one implementation, a mock. The mock is not a shortcut
past the real path: pressing "pay" posts a genuinely signed webhook to
`/api/payments/webhook`, the same route and the same signature check a real
provider would use. Which provider we end up with is still
DECISIONS_NEEDED.md item 1, and nothing in the codebase names one.

**Three deliveries, one credit.** The test fires them in parallel, not in
sequence — sequential calls would pass against a check-then-act that a real
provider's retries would break. One `credit_purchases` row, one ledger entry,
one lot of credits, because `ledger_entries.idempotency_key` is unique and
`appendLedger` only moves balances for rows it actually inserted.

Pack prices moved out of the constant and into the table an admin edits at
`/admin/packs`. The constants remain as the shipped defaults for an empty
database.

### Booking

One `serializable` transaction: check the slot, debit the credits into escrow,
insert the booking. The availability engine runs against the transaction's own
view rather than the pool's — reading outside the isolation would defeat the
point of having it.

`pnpm prove:booking --clients 4` fires four genuinely parallel bookings at one
slot: **one succeeds, three get `slot_taken`, and the database holds one booking
and one escrow entry.** Getting there found a real bug: Drizzle wraps a driver
error, so the serialization failure (40001) never matched a top-level `code`
check and surfaced as a 500. A race that reads as a crash is a race the student
experiences as a broken site.

### Commission, as you specified it

20% on a student's first paid booking with a tutor, 15% on every one after,
decided by whether a paid session between them has actually happened
(`completed_at is not null`). Snapshotted at creation.

You then asked whether `tutor_profiles.commission_bps` was dead. It was — read
only for display. It is now a **floor**: the effective rate is the lower of the
negotiated rate and the retention rate, so a tutor recruited on 12% pays 12%
either way, and the column's default of 2000 means the floor never binds for
anybody who negotiated nothing. The tutor's own rates card and the admin
verification screen now say what will actually be charged rather than quoting a
number nothing used.

### Slot holds, rescheduling, disputes

A short balance holds the slot for ten minutes and sends the student to top up.
Expiry is read-time — `expires_at > now()` — so no sweeper can leave the
calendar lying about a slot.

Rescheduling: once, more than twelve hours out, six hours to answer, expiring on
the next read. The original booking stands until the other side agrees.

Disputes needed no change to the settlement job at all: `disputed` is not a
status `findBookingsAwaitingSettlement` looks for, so reporting a problem stops
the money by construction. `pnpm settle --dry-run` was added so "is this booking
due?" can be asked without settling every other booking that also is.

### The connection-failure policy you chose

The platform absorbs it: student refunded in full, tutor paid their full share
out of platform revenue, capped at two per student per 90 days. This is the one
outcome that does not reduce to a refund percentage — chargeable is zero and the
tutor is still paid — so it is the single branch in `resolveBookingOutcome` that
builds its own entries, and the ledger row is named `technical_failure_absorbed`
so a negative revenue line is never a mystery.

The Phase 4 test that asserted the tutor got nothing for a failed call now
asserts they are paid and that platform revenue goes negative by the same
amount. That is the policy changing, not a regression.

### A bug the change surfaced

Settlement threw `completed -> no_show_tutor` on a booking whose events did not
support the `completed` stamp it already carried. `classifyOutcome` now trusts
`completed_at`: it is only ever written by that same classifier agreeing at the
time, so a later reading that disagrees means the events are incomplete, not
that the lesson stopped having happened. Without it, a lost webhook could cost a
tutor a session's pay and a strike.

### Two things fixed on the way

- A session in progress fell out of "upcoming" the moment it started and
  appeared under "recent" — so the join link vanished exactly when it was needed
  and the product offered to file a dispute about a lesson still running.
- The dashboard only computed movable slots for the first three sessions, so a
  fourth could not be rescheduled for no reason a user could see. It is now one
  engine call per distinct tutor-and-duration, and every session on the page can
  be moved.

### Region measurement: instrument built, reading not taken

`pnpm measure:regions` times TCP and TLS handshakes to each candidate region,
Dubai first. **It cannot produce a valid reading from this sandbox**: outbound
traffic goes through a local egress proxy, so every region measures ~4ms and the
ranking is about the proxy. Run it from Karachi, from the Gulf, and from a
phone on mobile data — the numbers that decide this are the ones a student's
connection produces, not a data centre's. DECISIONS_NEEDED.md item 20 now says
so explicitly.

### Retention: decided

Raw LiveKit webhook bodies are dropped after 90 days and the events kept —
`pnpm`-less, on a daily cron at `/api/cron/retention`. Deliberately an `update`,
not a `delete`: losing the event would lose the attendance it proves, and with
it the ability to explain a payment years later.

### The gate

Typecheck clean, **509 unit tests**, build clean, **59 e2e tests**, ledger
reconciled to zero drift, migrations replay from an empty database. Lighthouse
on the new surfaces: credits **99 / 100**, dashboard **99 / 100**, tutor profile
**99 / 100**, feed **97 / 100**. The 360px suite now covers the credits page and
the checkout.

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

### Still owed at the time

Phase 3 checkpoint B — no `PaymentProvider`, no credit purchase, no paid
booking creation. Built since; see the checkpoint B entry above. The trial
conversion screen's call to action now leads to a calendar that can actually
take the booking.

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

`pnpm e2e` reseeds and drives the real UI. The Phase 6A twelve cover:

- the database refusing an AS Level under CBSE, and refusing a second primary
  position — a foreign key and a partial unique index, not a validation rule
- a student's class applied by default, with the banner naming it, cleared in
  one tap and restored in one more
- **an exact curriculum match ranking above a better-rated tutor who teaches
  something else**, asserted on the stored ratings rather than the rounded ones
  the card shows, because 4.563 and 4.6 both render as "4.6"
- the tiers coming out in order, with every card saying which one it is
- the triple filtering the feed, and the empty state offering the two ways out
  rather than a dead end
- an anonymous visitor still getting the whole board list, ordered for where
  their browser says they are, with "Other" always last
- a tutor adding a position, the counter reading the real list, and the subject
  picker offering only subjects already on their profile
- the admin flag firing on a mathematics degree against a music claim and
  staying quiet on the same degree against a maths claim
- the verification queue **not** being a wall of flags
- a student with no class being asked inline, in a feed that already works,
  and the answer landing as exactly one primary row
- the same student in Karachi and in Los Angeles getting a different order over
  the same tutors — an ordering term, not a filter
- every ranked tutor carrying a real `free_hours_mask`, with more than one
  distinct value, which a mask computed from the server's clock would not have

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
| Payment provider | `PaymentProvider` with a `MockProvider`. The mock posts a genuinely signed webhook to the real route. Which provider we use is `DECISIONS_NEEDED.md` item 1. |
| Hosted transcoding | `FfmpegVideoPipeline` works locally. A deployed environment needs ffmpeg somewhere — item 13. |
| Transcoding is inline | Fine for a 90-second clip in development; production should queue it (`SPEC.md` §14). Item 14. |
| Infinite scroll | The grid shows the first 24 with a count. Paging is a small addition once there is enough supply to need it. Item 15. |
| Notifications | In-app only. Email and WhatsApp are Phase 7 — item 22. |
| Payouts | The tables, the encryption and the `$100` threshold exist. Requesting and paying one is Phase 6, part C. |
| Admin dashboard | Verification, moderation, packs and curriculum. GMV, take rate and the reports queue are Phase 6, part C. |
| Payment providers | Card, JazzCash and Easypaisa all route correctly and all three are mocks. No merchant account exists yet — item 1. |
| Parent accounts | An under-18 account records a guardian's email and `guardian_id` is ready. A guardian cannot sign in and see it yet. |
| WhatsApp reminders | The number is collected and stored. Sending is Phase 7 — item 22. |
| Curriculum matching at scale | One correlated lookup per candidate row. Fine here; the step at a hundred thousand tutors is a denormalised array on `tutor_ranking` with a GIN index, written nightly. |
| Rate limiting | Real, but in-memory, so it is per instance. Needs a shared store before more than one node. Item 8. |

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
pnpm prove:curriculum          # the database refusing a class from the wrong board

pnpm dev                       # http://localhost:3000
pnpm e2e                       # reseeds, then drives the UI
```

`pnpm seed` needs `ffmpeg` and `ffprobe` on the PATH to build intro videos
(`apt install ffmpeg`, or Homebrew). Without them it seeds everything else and
says the videos were skipped.

### Last full run

```
pnpm typecheck   clean
pnpm test        55 files, 777 tests passed
pnpm build       compiled, 68 routes
pnpm seed        66 users · 40 verified · 5 pending · 1 draft · 1 rejected
                 10 boards · 214 tutor curriculum positions · 16 student ones
                 222 bookings spanning the repricing: 15/16/20/22 all present
                 3 standing arrangements, one already through a T-48h charge
                 152 chapters · 151 attached to sessions · 77 marked covered
                 27 pieces of homework: 27 set, 17 handed in, 12 marked
                 22 emails sent through the mock, 2 in dead letters
                 2 contact flags · 3 open reports · no sanctions
                 5 established pairs gone quiet, 3 still booking
                 zero ledger drift
pnpm e2e         105 passed
pnpm reconcile   zero drift — including straight after the e2e run
pnpm prove:curriculum      the database refuses all three
pnpm prove:rates           the rate change reached no booking that already existed
pnpm prove:payout-privacy  a dump of payout_methods yields nothing usable
pnpm prove:restore         dump, restore into a scratch database, check every
                           critical table and the ledger, drop it
pnpm launch:sql            5 packs · 10 boards · 46 classes · 12 subjects ·
                           152 chapters, applied twice against an empty database
```

Lighthouse on the built app, desktop preset: feed **99 performance / 100
accessibility**, tutor profile **100 / 100**, curriculum-filtered feed
**100 / 100**, tutor earnings **100 / 100**, admin dashboard **100 / 100**,
payout queue **100 / 100**, moderation queue **100 / 100**. Mobile emulation:
feed **99 / 100**, admin dashboard **99 / 100**, earnings **100 / 100**.

The dashboard's accessibility started at 92 — a `dl` whose groups carried the
value outside the `dt`/`dd` pair. Fixed rather than noted.

Phase 7's screens, same preset: standing-slot form **100 / 100**, progress
**100 / 100**, the student's homework **100 / 100**, the tutor's session page
**100 / 100**, the tutor's homework **100 / 100**, student dashboard
**100 / 100**. Mobile emulation at 360px: standing-slot form **100 / 100**,
progress **100 / 100**.
