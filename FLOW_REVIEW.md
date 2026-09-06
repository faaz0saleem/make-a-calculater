# Flow review

Every journey walked end to end as a person, not as a test — signed out, on a
390px phone viewport, against the built app with a seeded database, and again
with the world shrunk to three tutors and then to none.

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
| S1 | **Blocker** | **There is no password reset.** No `/forgot-password`, no reset email, no token. Somebody who forgets their password cannot reach their account, their credits, or their booked lessons — and their credits are money they have already paid. | **Open.** See below. |
| S2 | **Blocker** | **Email addresses are never verified.** `users.email_verified_at` exists and nothing ever sets it. Anybody can sign up as anybody's address, and every notification for that account then goes to a stranger. | **Open.** `DECISIONS_NEEDED.md` item 6 asks whether verification should gate or nudge; it is still unanswered, and the answer changes the flow rather than the plumbing. |
| S3 | Sharp | Session reminders did not exist. Fourteen templates, nothing sending them, and no scheduled job for the reminder script. | **Fixed** — outbox, retries, dead letters, and `/api/cron/reminders`. |
| S4 | Sharp | The booking bar floats over the page and was styled exactly like the cards it floats over, so on a phone it read as a card pasted on top of a tutor's bio, cutting a sentence in half. | **Fixed** — an upward shadow, a ring, and bottom padding so the last card clears it. |
| S5 | Sharp | A student cancelling with 24 hours *and a few seconds* of notice was refunded half. The tier was decided on floored minutes. | **Fixed** — tiers compare exact time; two tests pin the boundary. |
| S6 | Rough | The calendar renders four days at once, every half hour, inline. On a phone that is about 2,500px of buttons before the reviews. Nobody scrolls past it to read anything else. | Open. A day picker, or collapsing to the next two days with "show more", would halve the page. |
| S7 | Rough | Times are labelled UTC until the browser's timezone probe lands, so the first paint of the calendar can show a signed-out visitor times in a zone they do not live in. | Open. The probe is fast and the label is honest, so this is a flicker rather than a lie. |
| S8 | Rough | Nothing tells a student what happens to a trial request while they wait. The tutor has twelve hours; the student's dashboard says "pending" and not "they have until Thursday 9pm". | Open. One sentence on the dashboard card. |

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
| T1 | **Blocker** | Same as S1 — no password reset. A tutor locked out cannot be paid. | **Open.** |
| T2 | Sharp | There was no way to recruit a tutor directly. Every tutor had to find the signup page and then wait in a review queue of one. | **Fixed** — `/admin/invite` makes a single-use link; the tutor's credentials are pre-approved and their profile goes live when they finish the wizard. |
| T3 | Sharp | The invite page asked for "at least 10 characters" and then rejected a 10-character password, because the real rule also wants a number. | **Fixed** — the rule and its wording now live in one file that both forms read. |
| T4 | Sharp | A verified tutor with an empty profile would have appeared in the feed as a blank card. This became reachable the moment invites existed. | **Fixed** by design: an invite creates a *draft* profile. Pre-approval skips the document queue, not the profile. |
| T5 | Rough | The tutor dashboard does not say when the next payout window opens, only the balance and the $100 threshold. A tutor at $96 has no idea what to do next. | Open. One line: "$4.00 more, or about one session." |
| T6 | Rough | Nothing tells a tutor their ranking penalty exists until they have already been penalised. The reliability rungs are only visible after a no-show. | Open, and arguably correct — a visible penalty ladder is also a map of how close you can get to the line. |

---

## Admin: alerts → verification → disputes → reports → moderation → payouts → curriculum → invites

| # | Severity | Finding | Status |
|---|---|---|---|
| A1 | **Blocker** | `/admin/alerts` returned a 500 on every load: the query read `ledger_entries.amount_cents`, a column that does not exist. The screen built to tell you what is broken was itself broken, and only a walkthrough would find it — nothing else reads that query. | **Fixed.** |
| A2 | Sharp | There was nowhere to see that a scheduled job had stopped. Settlement, reminders and the series charge all failed silently. | **Fixed** — `/admin/alerts` covers settlement behind, stuck payouts, ledger drift, empty rooms, stalled payments, refund spikes, dead letters and a queue that is not draining, each with a runbook link. |
| A3 | Sharp | `pnpm reminders` and `pnpm series` existed only as scripts. On Vercel nothing ran them, so a production deployment would send no reminders and never charge a standing session. | **Fixed** — both have cron routes and schedules. |
| A4 | Rough | Every admin queue is a separate page with no count on the nav. You have to open four screens to learn there is nothing to do. | Partly fixed: `/admin/alerts` answers it in one screen, and is now the first nav item. |
| A5 | Rough | The payout queue shows the last four digits and the wallet name, which is correct and deliberate — but there is no way to record *why* a payout was rejected beyond the reason field, and no way to see a tutor's payout history from the queue. | Open. |

---

## Signed out, and the first impression

| # | Severity | Finding | Status |
|---|---|---|---|
| P1 | **Blocker** | Every legal page, the sitemap and robots.txt redirected anonymous visitors to sign-in. A regulator, a crawler and a customer all saw a login form. | **Fixed** — one allowlist, derived from the content modules so a new policy cannot be private by accident. |
| P2 | Sharp | With three tutors, "Free trials", "New tutors" and "All tutors" showed the same three people. Twelve category chips led to nine empty pages. | **Fixed** — the feed's shape is a function of its inventory. |
| P3 | Sharp | With no tutors, the feed said "Nothing matched those filters. Clear them and start again" to somebody who had set no filters. | **Fixed** — an empty catalogue has its own state and its own two calls to action. |
| P4 | Sharp | A curriculum search that found nothing was a dead end and left no trace. | **Fixed** — nearest bookable positions are offered, and the ask is recorded (anonymously when signed out) and shown on the admin dashboard. |
| P5 | Sharp | The feed's shape was decided on the *filtered result count* rather than the catalogue size, so a signed-in student whose declared class matched two tutors got the filter panel folded away and the rails hidden — at the exact moment they needed the controls to widen their search. Caught by the e2e suite after the change, which is what it is for. | **Fixed** — `feedShape` takes the whole catalogue; the two are different questions and the function now says so. |
| P6 | Rough | The homepage still shows a signed-out visitor the full filter panel once there are six or more tutors. That is right at forty and heavy at eight. | Open. |

---

## The two blockers, in detail

### S1 / T1 — password reset

Nothing exists: no route, no token, no template. This is the one finding on this
list that stops a launch on its own, because the failure is silent — somebody
just never comes back, and you never learn why.

**Why it is not fixed here:** it is an authentication flow, and the fourteen
templates this phase was asked to wire do not include one. Building it properly
needs a stored single-use token (not the HMAC the unsubscribe link uses — a
reset token has to be revocable), a rate limit on the request endpoint, a
decision about whether resetting signs out other sessions, and a fifteenth email
kind. That is an hour of careful work and it deserves to be done deliberately
rather than at the end of a long session.

**What it needs, concretely:**

- `password_resets (id, user_id, token_hash, expires_at, used_at, created_at)`,
  30-minute expiry, single use enforced the same way the invite is — an
  `used_at is null` guard inside the claiming update.
- `/forgot-password` → always answers "if that address has an account, we have
  sent a link", regardless. Never confirm which addresses exist.
- `/reset-password/[token]` → the new password, then invalidate every other
  session for that user (`AUTH_SECRET` cannot be rotated per user, so the
  practical version is a `sessions_valid_from` column the JWT callback checks).
- A fifteenth email kind, `password_reset`, operational and not optional.
- Rate limit the request by IP *and* by address: without the second one, this
  endpoint is a way to send somebody a hundred emails.

### S2 — email verification

The column exists and nothing sets it. Today, anybody can sign up with anybody's
address, and every notification for that account goes to a stranger.

`DECISIONS_NEEDED.md` item 6 asks whether verification should be a gate (cannot
book until verified) or a nudge (a banner). That is a product decision with real
consequences for conversion, and it is still unanswered — which is why the
plumbing has not been built to one shape or the other. The email infrastructure
is now in place, so whichever answer you give is a small change.

---

## What was fixed during this review

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
