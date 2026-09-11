# Bugs

Phase 10, part one. A hunt, not a feature. Everything below was found by using
the product or by reading for a named pattern — not by running the suite, which
was green throughout and stayed green while every one of these was true.

**Fourteen findings. Twelve fixed, two not.** Ordered by severity, not by the order
they were found.

| # | What | Class | Severity | Fixed |
|---|---|---|---|---|
| 1 | A signed-in session never re-read roles or suspension, so demoting an admin or suspending an account did nothing | silent pass | **Critical** | Yes |
| 2 | A minor could book, start a standing arrangement or ask for a trial with no guardian on record | silent pass | **Critical** | Yes |
| 3 | No error boundary anywhere: a failure showed a digest number and said nothing about money | error path | **High** | Yes |
| 4 | The pre-call check said "Video and audio should both be fine" with the video service unreachable | invented number | **High** | Yes |
| 5 | `lifetime_earned_cents` sat outside reconciliation — the exact sibling of the Phase 9 bug | unreconciled | **High** | Yes |
| 6 | One reply ever was rendered as "Usually replies within an hour" and badged "Responds in <1h" | invented number | Moderate | Yes |
| 7 | Picking a slot somebody else was holding walked the student on anyway, under a banner saying it was held for them | walk | **High** | Yes |
| 8 | Double-clicking Book charged the student, made the booking, and told them the time was no longer free | walk | **High** | Yes |
| 9 | The booking page told a student their slot was held while also telling them it was not | walk | Moderate | Yes |
| 10 | "Sign in" on the signup page dropped the slot a returning student had chosen | walk | Moderate | Yes |
| 11 | `pnpm prove:booking` printed its result and exited 0 whatever it found — a double-booking proof that proved nothing | silent pass | Moderate | Yes |
| 12 | Admin rates rendered "0.0%" when the denominator was zero | invented number | Low | Yes |
| 13 | Strikes never expire, and "3 strikes in 90 days = review" does not exist | silent pass | Moderate | **No** |
| 14 | A minor is refused a trial with nowhere on the trial journey to give a guardian's email | walk | Moderate | **Partly** |

Seven guards had no test proving they refuse anything. They have one now:
`e2e/guards.spec.ts`.

---

## 1. A session never re-read roles or suspension

**Class:** silent pass. **Severity:** critical — privilege escalation.
**Fixed.**

**What I did.** Read `src/auth.ts`, looking for guards whose comment claims
more than the code does — the shape of the "sign out everywhere" bug.

**What I found.** This comment sat above the `jwt` callback:

> The JWT carries the roles. On sign-in they come from the provider result; on
> later requests **they are re-read from the database so a role change or a
> suspension takes effect** without waiting for the token to expire.

The condition underneath it is `trigger === 'update' || !token.roles`. After
the first sign-in neither is ever true: `trigger` is only `'update'` when
something calls `unstable_update`, which in this codebase only the
change-password action does, and `token.roles` is set at sign-in and never
cleared. **The re-read never ran.**

`requireRole('admin')` reads `session.user.roles`, which comes from that token.
So:

- Taking `admin` away from somebody left them an admin for up to thirty days,
  across all nine admin screens — including the payout queue, where they
  approve money leaving the platform, and dispute resolution, where they
  refund it.
- The six places that check `users.suspended_at` all covered *new* actions —
  signing in, being booked, appearing in the feed. None covered the session a
  suspended person was already holding.

**What should have happened.** A role taken away is taken away now. An account
suspended is suspended now.

**Fixed.** `currentUser()` already made one database read per request, for
`sessions_valid_from`. Roles and `suspended_at` come back in the same query
(`accountFacts`), and a suspended account resolves to no user at all. The token
keeps its copy of the roles for the edge middleware, which has no database —
and the comment now says that is what it is for.

Proved by `e2e/guards.spec.ts`: an admin is demoted mid-session and bounced off
the payout queue on the next navigation; a student is suspended mid-session and
loses the dashboard.

**Not fixed, and related:** nothing in the product ever *sets* `suspended_at`.
The sanction ladder stops at "review", whose own copy says "This does not
suspend anybody". So an admin who reads a whole history and decides somebody
must go has no button. That is a missing feature, not a bug, and building it
was out of scope here.

---

## 2. A minor could book with no guardian on record

**Class:** silent pass. **Severity:** critical — child safety, and money.
**Fixed.**

**What I did.** Took the user's list of guards and asked, for each, whether any
test proves a violation is *refused*. For the under-18 rule the only test is
`e2e/signup.spec.ts`, and it proves the field appears and is saved when filled.

**What I found.** The guardian email is required by an `required` attribute on
an input, and by nothing else. `confirmBooking` reads it as:

```ts
const guardianEmail = String(formData.get('guardianEmail') ?? '').trim();
if (guardianEmail) await linkGuardian(user.id, guardianEmail);
```

`createBooking` never looks at `is_adult` or `guardian_email` at all. Removing
the attribute in devtools — or posting the server action directly — books a
child into a paid session with no adult on record. `createSeries` and
`requestTrial` had no check either, so the same was true of a standing weekly
arrangement and of a free trial.

**What should have happened.** The terms say it plainly: "Accounts requiring
verified consent must not be activated for the relevant processing **or
lessons** until that consent … has been satisfied." A lesson is a lesson
whether or not it is paid for.

**Fixed.** All three paths now refuse with `guardian_required`, inside the same
transaction that would have taken the credits, and the message says nothing has
been charged. `e2e/guards.spec.ts` strips the attribute the way anybody with
devtools would and asserts no booking row exists afterwards.

**Worth knowing:** the terms also say "Providing an email address alone does not
establish legally valid parental consent", and `DECISIONS_NEEDED.md` has an open
review item for exactly this. What is fixed here is that the product now
enforces the thing it already asks for. Whether an email is enough is a legal
question nobody has answered.

---

## 3. There was no error boundary anywhere

**Class:** error path. **Severity:** high. **Fixed.**

**What I did.** Stopped Postgres and loaded the site.

**What I found.** `find src/app -name "error.tsx" -o -name "global-error.tsx"`
returned nothing. With no boundary, any unhandled failure rendered Next's
production default:

> Application error: a server-side exception has occurred while loading
> localhost (see the server logs for more information). Digest: 1647492444

On the booking confirm screen that is what a student sees after pressing a
button that says "Book and hold $5.00". No statement about their credits, no
way back, and a number that means nothing to them.

**What should have happened.** Plain words, a way out, and — because half these
screens are money — a sentence about whether anything was charged.

**Fixed.** `src/app/error.tsx` and `src/app/global-error.tsx`. Verified in a
browser with the database stopped:

> **Something went wrong at our end.** Not something you did… **Nothing has
> been charged.** Credits only move when you press a button that names the
> amount and you are shown a confirmation afterwards — if you did not see one,
> the money is still in your balance. **[Try again] [Go to your dashboard]**

**One thing this is not.** The server does *not* fall over when the database
goes away — I checked, because I first thought it had. It keeps serving, errors
the requests that need data, and recovers on its own when Postgres returns.

**Checked and already correct:** a 404 renders inside the layout with "could not
be found"; `/api/health` returns 503 with a per-dependency breakdown; the
too-weak-connection verdict already said "you have not been charged".

---

## 4. "Video and audio should both be fine" with the video service down

**Class:** invented number. **Severity:** high. **Fixed.**

**What I did.** Killed LiveKit, opened a session as the student, pressed "Run
the check".

**What I found.**

> **Your connection looks good.** Video and audio should both be fine.
> **[Join the session]**

The check downloads a file from our own origin and times three round trips to
it. It never touches LiveKit. So the sentence "video and audio should both be
fine" is a claim about a service the check does not measure, shown on the
screen somebody opens for a lesson they have paid for. `/api/health` knew
LiveKit was down at the same moment.

**What should have happened.** If we cannot reach the classroom, say so.

**Fixed.** The check now asks `/api/health` alongside the other two
measurements, and when LiveKit is not up it replaces the verdict — rather than
sitting above it, which produced two contradictory sentences on one screen:

> **Our video service is not responding.** Your own connection is fine — this is
> at our end. Nothing extra has been charged, and if the session cannot go ahead
> you are refunded in full.

A health check that cannot be reached returns `null` and changes nothing, so a
blocked request does not invent a failure either.

---

## 5. `lifetime_earned_cents` was outside reconciliation

**Class:** unreconciled. **Severity:** high — money, and it is the Phase 9 bug's
twin. **Fixed.**

**What I did.** Listed every column that looks derived and checked each against
the seven balances `reconcileLedger` covers.

**What I found.** `tutor_profiles.lifetime_earned_cents` is moved by
`applyToMaterialisedBalance`, from `tutor_pending` entries with a positive
delta, and nothing compared it to anything. That is exactly the shape of
`lifetime_purchased_cents`, which drifted undetected from Phase 2 to Phase 9
for precisely this reason.

There is no drift today. That is not the point: the column is one careless line
away from the same bug and nothing would catch it.

**Fixed.** An eighth reconciliation check. `pnpm reconcile` — zero drift across
eight balances.

**Also checked, and deliberately left:**

- `bookings.reschedule_count` — derived from `reschedule_requests`, checked by
  hand against the seeded world with zero drift, and it governs a UI rule
  ("already been moved once") rather than money.
- `tutor_ranking.*` — denormalised, but the nightly job rewrites every row from
  scratch, so drift self-heals within a day.
- `tutor_profiles.strikes` — see finding 10.

---

## 6. One reply rendered as a habit

**Class:** invented number. **Severity:** moderate. **Fixed.**

**What I did.** Followed the 4.3-star pattern: a value that is correct as an
input to ranking and a fabrication as a statement to a person.

**What I found.** `responseMedianFor` returns a median from any number of
observations, including one. A tutor who has answered exactly one message in
their life gets, on their profile:

> Usually replies within an hour

and on their card the badge **Responds in <1h**. "Usually" from a single
anecdote. The rating has a Bayesian prior precisely to stop this; the response
time had no minimum sample at all.

**Fixed.** Three replies before a median is reported; below that it is `null`
and both the sentence and the badge are simply absent, which the code already
handled correctly. `medianSeconds` stays a plain median with no opinions — the
rule lives in the domain function. Four tests, including the one-reply case
that was the bug.

---

## 7. A slot somebody else was holding walked the student on anyway

**Class:** found by walking. **Severity:** high. **Fixed.**

**What I did.** Opened one tutor's calendar in two browsers, as two different
students — the "open it in a second tab" case. Both pages showed the same free
hour. One student clicked it. Then the other student clicked the hour their own
page was still showing.

**What happened.** The second student was taken straight to the confirm page for
a slot they could not have. Signed out, it is worse: they were sent to sign up,
under this banner —

> **That time is held for you for ten minutes.** Finish here and you will land
> straight back on it.

— which was false when it was written. They could then create an account and buy
credits before anything told them the truth, and the refusal only came at the
final button.

**What should have happened.** They should be told at the click, on the calendar,
while the only thing they have spent is a click.

**Why it was there.** `holdSlot` has always refused this and returns
`{ ok: false, problem: 'slot_taken' }`. The action that called it discarded the
return value twice:

```ts
await holdSlot({ guestToken, tutorId, startAtUtc, durationMinutes });
redirect(`/signup?next=${encodeURIComponent(bookHere)}&held=1`);
```

A guard whose answer is thrown away is not a guard. This is the same shape as
finding 1, and it is why "does the check run?" is the wrong question.

**Worth being precise about the blast radius.** The tutor page *does* hide slots
another student is holding, so a freshly loaded calendar never offers one. This
needs a page that has been open a little while — a second tab, or one left and
come back to. That is most pages, and the hold window is ten minutes.

**Fixed.** Both calls now check, and a refusal goes back to the calendar with a
message that also says nothing has been charged, because picking a slot never
touches money. `e2e/guards.spec.ts` covers it, and I checked the test fails with
the fix removed — twice, because the first revert only removed one of the two
call sites and the test still passed. A negative test that has not been seen to
fail is finding 1 again.

---

## 8. Double-clicking Book charged them and said it had not

**Class:** found by walking. **Severity:** high. **Fixed.**

**What I did.** Opened the booking page as a student, throttled the connection
to roughly 3G, and pressed **Book and hold $65.00** twice — the way anybody
presses a button that has not visibly done anything yet. The button has no
pending state, so both submits land.

**What happened.** The booking was made. $65.00 moved into escrow. And the page
the student was left looking at said:

> Confirm your booking
> Nothing is charged until you press the button below.
>
> **That time is no longer free. The calendar below is up to date.**

Verified in the database at that moment: one booking, `confirmed`, and one
escrow entry for 6500 cents. The student is being told their booking did not
happen while their money is held for it. The obvious next thing they do is book
another slot, and pay again.

**What should have happened.** They have the session. Say so, and take them to
it.

**Why it was there.** The second submit reaches `createBooking`, which asks the
availability engine whether the slot is free, finds it is not — because of the
booking the first submit just made — and returns `not_available`. Nothing asked
*whose* booking was in the way. "Somebody just took that time" and "that time is
no longer free" are both written for a stranger taking the slot, and both are
false when the person in the slot is the person reading the message.

**What was never at risk.** The money. The partial unique index and the
serializable transaction mean one booking and one debit however many submits
arrive — I raced two `createBooking` calls for the same student and slot and got
`["slot_taken", "ok"]`, one booking, one escrow row, one debit of $35. This was
never a double-charge. It was a lie about a charge, which is its own kind of
expensive.

**Fixed.** On the two paths that can lose — the availability check and the
unique-index race — `createBooking` now asks whether this student already holds
a live booking at that slot, and returns `already_booked` with its id if so.
`confirmBooking` sends them to `/dashboard?booked=<id>`: exactly where the first
submit would have taken them. A double-click is now indistinguishable from a
single one, which is what a student pressing twice means.

**Deliberately not done: disabling the button while the form is in flight.**
That is the usual cure and it is the wrong one here. It needs a new client
component (`useFormStatus` appears nowhere in this codebase), it is a new thing
rather than a fix to a broken one, and it does nothing for the cases that are
not double-clicks — a retried POST, a flaky connection, a page restored from
the back-forward cache. The refusal telling the truth covers all of them.

---

## 9. The booking page contradicted itself about the hold

**Class:** found by walking. **Severity:** moderate. **Fixed.**

**What I did.** Opened the booking page, then expired the slot hold out from
under it and reloaded — one of the "let a hold expire while the page is open"
cases.

**What I found.** Two statements on one screen:

> This time is **not held**. Somebody else could take it while you finish.

and, in the top-up card immediately below:

> Buy credits without leaving this page. **Your slot stays held while you do.**

The second is unconditional copy. A student reading it is being told their slot
is safe at the exact moment they decide whether to spend $5 or $100.

**Fixed.** The top-up line now depends on whether a hold exists, and says the
opposite when it does not.

---

## 10. "Sign in" on the signup page dropped the chosen slot

**Class:** found by walking. **Severity:** moderate. **Fixed.**

**What I did.** Signed out mid-booking and followed where the app sent me.

**What I found.** The paywall works as designed: picking a slot while signed
out sends you to `/signup?next=/tutors/…/book?mode=60&at=…`, carrying the slot.
But the "Already registered? **Sign in**" link on that page is a bare
`href="/signin"`. A returning student — the commonest case, since anybody who
already has an account lands there — loses the slot they picked and arrives on
their dashboard instead. The link in the other direction has always carried
`next`.

**Fixed.** One line.

---

## 11. The double-booking proof exited 0 whatever it found

**Class:** silent pass. **Severity:** moderate. **Fixed.**

**What I did.** Ran `pnpm prove:booking` against a database the e2e suite had
just finished with, as a final check before pushing.

**What happened.** It printed this and exited 0:

```json
{ "succeeded": 0, "failures": ["slot_taken", "slot_taken"],
  "bookingsInDatabase": 0, "escrowEntries": 0 }
```

Nobody won the race. The slot it picked was already held by somebody else, so
the two clients were refused before they ever reached the serializable
transaction, and the thing the script exists to prove was never exercised. It
reported that as success.

**What should have happened.** Exit non-zero. Its own docblock says "Exactly one
must succeed"; nothing enforced it.

**Why it matters.** This is the script that proves double-booking is impossible
— the invariant the whole booking design is built around. `RUNBOOK.md` offers it
as the check to run against a new environment. Anyone running it there would
have got a wall of JSON and a zero exit code, and a regression that made *every*
booking fail would have looked identical to a pass.

`e2e/booking.spec.ts` does assert on the JSON, so CI was never blind. The
standalone tool was.

**Fixed.** It now checks its three outcomes and exits 1 with a reason, naming
the "nobody won, so nothing was proven" case specifically. stdout stays pure
JSON because the e2e parses it; the verdict goes to stderr. Verified both ways:
green on a free slot, and

```
FAILED:
  nobody won the race (slot_taken, slot_taken) — the slot was not free to
  begin with, so nothing was proven
```

with a hold placed on the slot first. `prove-payout-lock.ts` already did this
and even has a comment explaining why; this script predates it and never got the
same treatment.

---

## 12. Admin rates said "0.0%" with nothing to divide by

**Class:** invented number. **Severity:** low — admin-only, and the denominator
is printed next to it. **Fixed.**

**What I found.** `bps(part, whole)` returns `0` when `whole` is `0`, and the
dashboard renders that as `0.0%`. On day one that reads as "Trial to paid
**0.0%**", "Coverage **0.0%**", "Effective take rate **0.0%**" — four
statements about a business that has not started. "We have no data" is a
different thing from "the rate is zero".

**Fixed.** `pct` takes the denominator and returns an em dash when it is zero.

---

## 13. Strikes never expire, and the review trigger does not exist

**Class:** silent pass. **Severity:** moderate. **NOT FIXED — needs a decision.**

**What I found.** `src/db/settlement.ts` carried this comment:

```ts
// SPEC.md §2: three strikes in 90 days triggers a review.
if (outcome.tutorStrike) { /* strikes = strikes + 1 */ }
```

The comment describes a feature that does not exist. There is no window, no
job that looks for a third strike, no queue that shows one, and no admin is
told anything. `/admin/alerts` — the screen built for "what needs a human" —
has no strikes row.

Worse, what the counter *does* drive it drives for ever. `hasInstantBooking`
and `reliabilityPenalty` read the lifetime total, so a tutor who missed two
sessions in their first month is still on manual-accept, and still carrying up
to 1,500 ranking points of penalty, two years later. In the seeded world five
tutors carry more strikes than a 90-day window would give them.

**Why it is not fixed.** Two reasons, and both are the user's call rather than
mine.

1. **The review trigger is a feature.** A job, a queue row and an admin surface
   is new product, and this phase is explicitly not that.
2. **Making strikes decay needs data that does not exist.** There is no record
   of *when* a strike was awarded. Deriving one from bookings almost works —
   `cancelled_by_tutor` is unambiguous, and a tutor no-show on a paid session
   is identifiable from the ledger reason — but a no-show on a *free trial*
   writes no ledger rows at all and is indistinguishable from a technical
   failure on the same trial, which SPEC.md says must **not** be a strike.
   Getting that wrong punishes a tutor for our own connection dropping. The
   honest fix is to record strike events, and that is a table.

**What I did do:** replaced the comment with one that describes the code, so the
next reader is not told the window exists.

---

## 14. A minor is refused a trial with nowhere to give a guardian's email

**Class:** found by walking. **Severity:** moderate. **PARTLY FIXED.**

Finding 2 closed the hole on all three paths. On the paid paths that is clean:
the guardian field is on the booking form, so the refusal names the field the
student is looking at.

The trial journey has no form. A trial is requested by clicking a slot, so a
minor who has never booked now hits a refusal with nowhere to comply. The
message points them at the booking page, where the field is, and says nothing
is charged until they confirm — workable, and not good.

**Why it is not fully fixed.** The fix is a guardian field on the trial journey
or at signup, and both are new UI. More to the point, the terms already say an
email alone is not valid consent and `DECISIONS_NEEDED.md` carries an open
review item on what consent must actually look like. Designing a consent step
now, guessing at the shape, would be the wrong order. Gating the paths is a
strict improvement; the journey should be built once somebody has answered what
it has to collect.

---

## Guards that turned out to work

Worth recording, because "we looked and it was fine" is a result:

- **Double-submitting a booking** — one booking and one debit, every time.
  *Recorded here in the first pass as wholly fine, which was half right: the
  money was never in danger and the message was a lie. See finding 8.*
- **Back, then confirm again** — no second booking and the balance correct. The
  refusal text was the same lie as finding 8 and went the same way; pressing
  back now shows the booking they have.
- **A hold expiring with the page open** — the page stops claiming the slot is
  held (and now stops contradicting itself, finding 7).
- **The admin wall** — a student is bounced off all nine admin pages; an admin
  reaches all nine. Both directions are now tested.
- **Every admin server action** calls `requireRole('admin')` — all twenty-eight
  call sites across nine action files.
- **A purchase whose webhook never arrives** shows as `pending` in the
  student's own purchase history rather than vanishing.
- **Cancelling the same booking twice.** Read rather than run. Sequentially it
  refuses with `not_cancellable` before touching anything. Concurrently the
  second transaction blocks on `SELECT … FOR UPDATE` inside `moveBookingStatus`,
  reads the now-terminal status, and throws — and because the refund entries
  were appended in that same transaction, they roll back with it. That is three
  stops, and no test exercises any of them.
- **Marking the same payout paid twice.** Read rather than run: the row is
  locked with `SELECT … FOR UPDATE` inside the transaction, the payout state
  machine refuses `paid → paid`, and the `UPDATE` is additionally guarded on the
  status it read. Three independent stops, none of them exercised by a test —
  which is what the whole silent-pass section is about, so it is named here
  rather than claimed as proven.
- **Submitting the confirm form twice** never double-charged. Only the message
  was wrong (finding 8).
- **Signing out mid-booking** and then pressing Book lands on `/signin` with no
  stack trace. It does drop the slot they had chosen — `requireUser()` redirects
  to a bare `/signin` with no `next` — which is the same papercut as finding 10
  in a place that is harder to reach. Not fixed: threading a return path through
  the auth boundary touches every caller, and the hold survives ten minutes, so
  what is lost is a click rather than a slot. Worth doing, larger than a bug fix.
- **The $100 payout threshold**, the trial-per-pair rule, both verification
  gates and the rate limiter all already had tests that prove a refusal.

## Where the negative tests were missing

Six guards ran, returned success, and had nothing proving they ever refuse
anything. `e2e/guards.spec.ts` now covers:

1. a student is refused every admin page;
2. an admin reaches every admin page (so a wall that refuses everybody does not
   read as a pass);
3. a demoted admin loses access on the session they are already holding;
4. a suspended account loses its session;
5. a minor with the `required` attribute stripped is refused a booking, and no
   booking row exists afterwards;
6. a student picking a slot another student is holding is refused at the click,
   and no second hold is written;
7. the booking form submitted twice produces one booking, one escrow entry and
   one debit, and lands the student on the session they have.

Each of these was run against the code with its fix removed, and each failed.
That step is not optional: test 6 passed against a half-reverted build, because
the revert had missed one of the two call sites — a negative test nobody has
watched fail is just a test.

Four guards still have no negative test, and all four are honest gaps rather
than oversights:

- **The dispute window** (`window_closed` is returned and never asserted) and
  **the series notice period**. Neither is reachable from the UI without
  manufacturing a booking at a specific age, which is a fixture, not a test.
- **Cancelling the same booking twice** and **marking the same payout paid
  twice**, both concurrently. I read both paths closely and both look sound —
  row lock, terminal state, rollback — but reading is how the first seven
  findings in this document survived for nine phases. Racing two refunds needs
  the same harness `prove-no-double-booking.ts` uses, pointed at cancellation.

All four are worth doing and all four are larger than this phase.
