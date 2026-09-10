# Flow review

Every journey walked end to end as a person, not as a test — signed out, on a
phone viewport, against the built app with a seeded database, and again with
the world shrunk to three tutors and then to none.

Walked twice. The first pass is the numbered findings below; the second, after
everything changed, is near the bottom and found three more — including a
rating on every card that nobody had given.

Severity means one thing here:

| | |
|---|---|
| **Blocker** | Somebody cannot finish, or loses money or access. Do not launch. |
| **Sharp** | They can finish, but they have to guess, back up, or be told twice. |
| **Rough** | It works and it is not good. Worth an hour when there is one. |

Fixed items say what the fix was. Open items say why not, and what it would
take.

---

## Student: signup → browse → profile → trial → convert → book → pay → session → review → rebook → standing slot → homework

**Steps from landing to a confirmed booking: 4.** Feed → profile → tap a slot →
Book and hold. That is short, and the paywall is in the right place: a
signed-out visitor sees the price, the calendar and the tutor's real slots, and
only meets the account wall when they commit. Signing up carries the chosen slot
through — `/signup?next=…&at=…` — and lands back on the same lesson.

The confirm screen states the price, the duration, the tutor, and that the slot
is held for ten minutes. Both buttons are honest: "Book and hold $5.00" and
"Give up this time".

| # | Severity | Finding | Status |
|---|---|---|---|
| S1 | **Blocker** | **There is no password reset.** No `/forgot-password`, no reset email, no token. Somebody who forgets their password cannot reach their account, their credits, or their booked lessons — and their credits are money they have already paid. | **Fixed** — single-use token hashed at rest, 30 minutes, rate limited by address and by IP, every session invalidated, and no path to the money. Proved end to end. |
| S2 | **Blocker** | **Email addresses are never verified.** `users.email_verified_at` exists and nothing ever sets it. Anybody can sign up as anybody's address, and every notification for that account then goes to a stranger. | **Fixed** — verification nudges and gates only money: a tutor's payout and a purchase over $25. |
| S3 | Sharp | Session reminders did not exist. Fourteen templates, nothing sending them, and no scheduled job for the reminder script. | **Fixed** — outbox, retries, dead letters, and `/api/cron/reminders`. |
| S4 | Sharp | The booking bar floats over the page and was styled exactly like the cards it floats over, so on a phone it read as a card pasted on top of a tutor's bio, cutting a sentence in half. | **Fixed** — an upward shadow, a ring, and bottom padding so the last card clears it. |
| S5 | Sharp | A student cancelling with 24 hours *and a few seconds* of notice was refunded half. The tier was decided on floored minutes. | **Fixed** — tiers compare exact time; two tests pin the boundary. |
| S6 | Rough | The calendar renders four days at once, every half hour, inline. On a phone that is about 2,500px of buttons before the reviews. Nobody scrolls past it to read anything else. | **Fixed** — two days open, the rest behind a `details` that says how much is in it: "8 more days · 72 more times, to Wednesday, Sep 23". |
| S7 | Rough | Times are labelled UTC until the browser's timezone probe lands, so the first paint of the calendar can show a signed-out visitor times in a zone they do not live in. | **Fixed** — Vercel and Cloudflare both resolve a timezone at the edge, so most visitors never see the swap. The probe still corrects it. |
| S8 | Rough | Nothing tells a student what happens to a trial request while they wait. The tutor has twelve hours; the student's dashboard says "pending" and not "they have until Thursday 9pm". | **Fixed** — the deadline as a clock time in their own zone, and what a lapse costs them, which is nothing. |
| S9 | **Sharp** | **A trial request that expired because the tutor never answered burned the student's one free trial with them, for life.** Found while writing the sentence for S8, which would otherwise have been a lie. | **Fixed** — `one_trial_per_pair` and the guards now forgive an expired request. A softening of SPEC.md §6; see below. |
| S10 | **Sharp** | **Mistyping a password rendered "Application error: a server-side exception has occurred".** Auth.js throws on a bad credential and the throw was uncaught, so the sign-in page's own "check your email and password" was unreachable. Found by resetting a password and then trying the old one, which is what everybody does. | **Fixed.** |

**The rebooking and standing-slot end of the journey is the strongest part.** The
offer to make it weekly appears after the second completed session with the same
tutor, the standing-slot form says what a month costs *and* that none of it is
taken today, progress carries between sessions, and homework closes the loop.

---

## Tutor: signup → wizard → verification → first booking → session → earnings → payout request → paid

**Steps to a live profile: the wizard's ten, and they are the right ten.** Every
one of them is something only the tutor can answer.

| # | Severity | Finding | Status |
|---|---|---|---|
| T1 | **Blocker** | Same as S1 — no password reset. A tutor locked out cannot be paid. | **Fixed.** |
| T2 | Sharp | There was no way to recruit a tutor directly. Every tutor had to find the signup page and then wait in a review queue of one. | **Fixed** — `/admin/invite` makes a single-use link; the tutor's credentials are pre-approved and their profile goes live when they finish the wizard. |
| T3 | Sharp | The invite page asked for "at least 10 characters" and then rejected a 10-character password, because the real rule also wants a number. | **Fixed** — the rule and its wording now live in one file that both forms read. |
| T4 | Sharp | A verified tutor with an empty profile would have appeared in the feed as a blank card. This became reachable the moment invites existed. | **Fixed** by design: an invite creates a *draft* profile. Pre-approval skips the document queue, not the profile. |
| T5 | Rough | The tutor dashboard does not say when the next payout window opens, only the balance and the $100 threshold. A tutor at $96 has no idea what to do next. | **Fixed** — "$0.50 to go — about one more session at your hourly rate." |
| T6 | Rough | Nothing tells a tutor their ranking penalty exists until they have already been penalised. The reliability rungs are only visible after a no-show. | **Fixed, partly, and deliberately not all the way.** A tutor with a clean record is now told once that turning up moves where they appear and that repeated absences cost instant booking. No point values and no strike count: the full ladder is a map of how close you can get to the line without crossing it. |

---

## Admin: alerts → verification → disputes → reports → moderation → payouts → curriculum → invites

| # | Severity | Finding | Status |
|---|---|---|---|
| A1 | **Blocker** | `/admin/alerts` returned a 500 on every load: the query read `ledger_entries.amount_cents`, a column that does not exist. The screen built to tell you what is broken was itself broken, and only a walkthrough would find it — nothing else reads that query. | **Fixed.** |
| A2 | Sharp | There was nowhere to see that a scheduled job had stopped. Settlement, reminders and the series charge all failed silently. | **Fixed** — `/admin/alerts` covers settlement behind, stuck payouts, ledger drift, empty rooms, stalled payments, refund spikes, dead letters and a queue that is not draining, each with a runbook link. |
| A3 | Sharp | `pnpm reminders` and `pnpm series` existed only as scripts. On Vercel nothing ran them, so a production deployment would send no reminders and never charge a standing session. | **Fixed** — both have cron routes and schedules. |
| A4 | Rough | Every admin queue is a separate page with no count on the nav. You have to open four screens to learn there is nothing to do. | Partly fixed: `/admin/alerts` answers it in one screen, and is now the first nav item. |
| A5 | Rough | The payout queue shows the last four digits and the wallet name, which is correct and deliberate — but there is no way to record *why* a payout was rejected beyond the reason field, and no way to see a tutor's payout history from the queue. | **Fixed** — each row now says "first payout — nothing paid to them yet" or "3 paid, $412.00 to date, last on Aug 12 · 1 refused". One grouped query, and still no account details. The rejection reason field was already there. |
| A6 | Sharp | **Two admins resolving the same dispute at once both saw an open report**, because the money moved in one transaction and the report closed in another. The second got an illegal-transition exception rather than an answer, and a process dying between the two left the credits refunded with the report still open. | **Fixed** — one transaction that claims the report first. See MONEY_AUDIT.md Q6. |

---

## Signed out, and the first impression

| # | Severity | Finding | Status |
|---|---|---|---|
| P1 | **Blocker** | Every legal page, the sitemap and robots.txt redirected anonymous visitors to sign-in. A regulator, a crawler and a customer all saw a login form. | **Fixed** — one allowlist, derived from the content modules so a new policy cannot be private by accident. |
| P2 | Sharp | With three tutors, "Free trials", "New tutors" and "All tutors" showed the same three people. Twelve category chips led to nine empty pages. | **Fixed** — the feed's shape is a function of its inventory. |
| P3 | Sharp | With no tutors, the feed said "Nothing matched those filters. Clear them and start again" to somebody who had set no filters. | **Fixed** — an empty catalogue has its own state and its own two calls to action. |
| P4 | Sharp | A curriculum search that found nothing was a dead end and left no trace. | **Fixed** — nearest bookable positions are offered, and the ask is recorded (anonymously when signed out) and shown on the admin dashboard. |
| P5 | Sharp | The feed's shape was decided on the *filtered result count* rather than the catalogue size, so a signed-in student whose declared class matched two tutors got the filter panel folded away and the rails hidden — at the exact moment they needed the controls to widen their search. Caught by the e2e suite after the change, which is what it is for. | **Fixed** — `feedShape` takes the whole catalogue; the two are different questions and the function now says so. |
| P6 | Rough | The homepage still shows a signed-out visitor the full filter panel once there are six or more tutors. That is right at forty and heavy at eight. | **Fixed** — folded below twenty, and open the moment anything is filtered. |
| P7 | **Sharp** | **Every tutor nobody had reviewed was shown as rated 4.3.** `bayesian_rating_milli` defaults to the prior, which is the right number to rank by and an invented one to display. On day one that is every tutor on the page. Found on the second walk, with three tutors in the world. | **Fixed** — no rating until somebody has given one, on the card, the profile header and the reviews panel. |
| P8 | Rough | A signed-out visitor scrolls roughly 800px of introduction on a 360px phone before the first tutor card. | Open, and it is somebody else's decision: the introduction is deliberate Phase 8 content. Condensing it, or moving it below the first row of cards, would halve the distance to a tutor. |

---

## The two blockers, closed

### S1 / T1 — password reset

Built to the design this document specified, and proved rather than asserted.
`e2e/auth.spec.ts` requests a reset, reads the link out of the outbox the way a
person reads their inbox, and then checks the four properties the design turns
on:

1. the old password stops working and the new one starts;
2. a session that existed before the reset is refused, even though its cookie is
   still in the browser;
3. the link is refused the second time, and when it has expired;
4. the wallet and the ledger are byte-identical either side of the whole thing.

The response is the same words whether the address exists, does not exist, or
has asked three times in the last quarter hour — and the test asserts that
nothing at all is queued for an address with no account.

Two things went wrong on the way, and both were worse than the thing being
built:

- **A mistyped password was a 500.** Recorded above as S10.
- **"Sign out everywhere" ran and protected nothing.** It compared the JWT's
  `iat` against `sessions_valid_from`, and Auth.js re-encodes the token on every
  request with a fresh `iat` — so no token was ever older than the reset. The
  check passed every time and defended nothing. Replaced with a claim we own,
  written only at sign-in and on an explicit update.

Fixing the second exposed a third: a revoked session still had a valid cookie,
so `/signin` bounced it to a dashboard that bounced it back, forever. Every page
that decides "signed in" now reads the guard rather than the raw session.

### S2 — email verification

Answered: **nudge, do not gate.** Browsing, booking and teaching all work with
an unconfirmed address. Two things do not, and both are money leaving or
entering for the first time — a tutor's payout, and a credit purchase over $25.

Both gates are pure functions, read by the screen so the button is refused
before it is pressed, and enforced again inside the transaction that would have
moved the money. Changing your address needs your password, unverifies it and
re-sends. The banner is dismissible for a week rather than forever, because it
is the only thing standing between a tutor and a payout request that will be
refused.

The wizard's step 1 stopped blocking submission as part of this: a tutor whose
profile is finished should be in front of students while they get round to
clicking a link.

---

## S9, in detail — the trial nobody should have lost

`one_trial_per_pair` is a partial unique index on `(student_id, tutor_id) where
is_trial`, with no status in the predicate. A request that expired because the
tutor never answered still occupied it, so the student had permanently lost
their one free trial with that person through no fault of their own.

It surfaced while writing the sentence for S8 — "if the time runs out the
request simply lapses" — which needed a clause about what it costs, and the
honest clause was "your free trial with them".

**The fix softens a rule SPEC.md §6 states as "for life"**, and is worth a
second opinion. `expired` is now outside the predicate and outside the guards.
Everything else still counts: a trial that happened, one the tutor declined,
one the student cancelled after it was accepted. The student cannot loop,
because the three-outstanding and five-a-week caps apply to every request
including the ones that lapse.

It also matched the philosophy already in the code a few lines away, where a
trial the tutor *declined* does not use up the student's week.

The same rule lived in three places — the guard, the profile's call to action,
and the index — and two of them were changed. The e2e caught the third, where
the button vanished for a student the database would have accepted. There is
one predicate now.

---

## What was fixed during the first review

Twelve things, most found by walking rather than by reading:

1. `/admin/alerts` 500'd on a column that does not exist.
2. Legal pages, sitemap and robots were behind the auth wall.
3. Reminders never sent — no wiring and no scheduled job.
4. `pnpm series` had no cron, so standing sessions would never have been charged.
5. Refund tier wrong by a rounding step at exactly 24 hours.
6. The booking bar read as a rendering fault on a phone.
7. The feed repeated the same three tutors under four headings.
8. An empty catalogue offered to clear filters that were not set.
9. Category chips led to empty pages.
10. A curriculum search that found nothing was a dead end.
11. The invite page's password hint contradicted the password rule.
12. The feed folded its own filters away when a search matched few tutors.

---

## The second walk, with three tutors in the world

The first pass found `/admin/alerts` returning 500 on every load. A second pass
over changed code was expected to find more, and did — walked signed out on a
360px phone with the catalogue shrunk to three verified tutors, then as a
brand-new unverified account, then as a tutor, then as an admin.

**What it found**

1. **P7, the rating nobody gave.** The worst of the three, because it is the
   first thing a visitor sees and it is a number we made up.
2. The reliability note was a bare paragraph floating between two cards, which
   reads as something left behind rather than something written. In a bordered
   box now.
3. **P8**, the length of the introduction before the first tutor. Left, and
   explained above.

**What it confirmed working**, which is the other half of a walk:

- The calendar fold says exactly what is behind it, and the profile is 2,900px
  instead of well over 4,000.
- The banner names the address and the threshold; small packs are buyable and
  the two over $25 are visibly refused with the reason and a link.
- "3 tutors match. Only verified tutors are listed." No rails, no dead chips,
  the filter panel folded, and "Every tutor on Tutorly" over the grid.
- The payout line reads "$0.50 to go — about one more session at your hourly
  rate."
- The payout queue's first row says "first payout — nothing paid to them yet".
- Nothing scrolls sideways at 360px on any of the eleven screens.

Three e2e tests failed when the database was reseeded a day later, and none of
them was flaky in the sense of "run it again":

- **The seed manufactured credential mismatches.** Where no template covered a
  subject it handed the tutor an unrelated qualification, so a Programming
  tutor held a degree in English Literature and the review screen flagged them
  — correctly — for a discrepancy the seed had invented. Three of five in the
  queue were flagged, and a flag that fires on most of a queue means nothing.
  The test whose whole job is to say so is the one that failed.
- Two tests read `.first()` where they meant "the one this test just made" and
  "one that has a video". Both now say what they mean.

---

## What is deliberately still missing

Not defects — decisions, and they are in `DECISIONS_NEEDED.md`:

- **A real payment provider** (item 1). Stripe does not operate in Pakistan.
  `mock` credits instantly and nobody is charged.
- **The free-session credit** (item 4). `SPEC.md` §2 promises one when a tutor
  no-shows. `resolveBookingOutcome` returns `freeSessionCredit: true` and
  nothing consumes it, because what it is worth has never been decided. The
  student is refunded in full, so nobody is out of pocket — but the promise in
  the spec is unkept, and the terms page deliberately does not repeat it.
- **WhatsApp** is a mock. The routing, dedupe and audience rules are live; the
  last HTTP call is not.
- **The five legal pages are drafts** and say so at the top of each.
- **The LiveKit region** (item 20) is unmeasured until somebody runs
  `pnpm measure:regions` from Karachi.
