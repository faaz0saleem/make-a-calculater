# Decisions needed

Questions that are genuinely yours to answer. Nothing here is blocking Phase 1 —
each has a working default in place, named below — but leaving them unanswered
gets more expensive the further we go.

---

## 1. Payment provider

**Blocks:** taking real money (Phase 7). **Default in place:** none yet; the
`PaymentProvider` interface and a `MockProvider` land with Phase 3.

`SPEC.md` §14 says Stripe will not serve a Pakistan-domiciled business. The
shortlist is Paddle, Lemon Squeezy, 2Checkout/Verifone, or a US/UAE entity with
Stripe. This is the one with a long lead time: merchant-of-record approval takes
weeks and asks for company documents.

Worth deciding early because it also settles whether we ever hold customer money
directly, which changes what the Terms have to say.

**Also:** do you want JazzCash/Easypaisa as a second provider for local
students? The interface supports more than one; the checkout UI needs to know.

## 2. Recurring availability across daylight saving

**Default in place:** both are stored, and the UTC copy is treated as
authoritative until you say otherwise.

`SPEC.md` §5 says weekly rules are entered in the tutor's timezone and converted
to UTC for storage. That is lossless for Karachi, which has no DST, but a New
York tutor who teaches at 6pm has a UTC time that shifts by an hour twice a
year. `availability_rules` therefore keeps both the UTC copy the spec asks for
and `start_time_local` / `end_time_local` / `timezone`.

The expansion engine in Phase 3 has to pick one. My recommendation is the local
copy — "6pm my time, all year" is what a tutor means — with the UTC columns kept
for fast querying and rebuilt when the rule changes.

## 3. A tutor declines a trial. Can the student ever ask again?

**Default in place:** no, per the spec's index.

`SPEC.md` §6 says one free trial per student-tutor pair for life, enforced by a
unique index on `(student_id, tutor_id)` where `is_trial = true`. That index is
in place and it also blocks a second request after a tutor *declines* one, or
after a request expires unanswered.

If a declined trial should not burn the student's one chance, the index needs a
status condition.

**Now built, and worth looking at.** Trials shipped in Phase 5 with the spec's
default. The consequence is now visible: a tutor who declines, or who simply
never answers within twelve hours, permanently uses up that student's one free
trial with them — the student got nothing and cannot ask again. The profile even
says so, which reads badly. My recommendation is to narrow the index to statuses
where the trial actually happened (`confirmed`, `in_progress`, `completed`,
`settled`, `no_show_student`), leaving `cancelled_by_tutor` and `expired` out of
it. That is a one-line migration and a change to `pairHasHadTrial`.

## 4. What is a "free-session credit" worth?

**Default in place:** `resolveBookingOutcome` returns
`freeSessionCredit: true` and nothing consumes it yet.

`SPEC.md` §2 gives a student one when a tutor no-shows, but `SPEC.md` §12 has no
table for it. Three workable readings:

- credits equal to that booking's price, straight into the wallet (simplest,
  and it is money the student can spend anywhere on the platform)
- a voucher for one session with *that* tutor (keeps the student with the tutor,
  needs a `vouchers` table)
- a voucher for any tutor up to some cap

The first needs no schema change. Phase 4 settles it.

## 5. Tables beyond SPEC.md §12

**Settled:** you approved `platform_accounts` and `credit_packs` after Phase 0.

Phase 1 adds one more, `tutor_languages` (tutor, ISO 639-1 code, proficiency).
§3 step 2 asks for spoken languages with proficiency and §4 lists language as a
search filter, so a joinable table beats a jsonb column. Say if you would rather
it were a column on `tutor_profiles`.

## 6. Email verification: gate or nudge?

**Default in place:** nudge. `users.email_verified_at` exists and the seed fills
it in, but nothing sends a verification email and nothing blocks on it.

`SPEC.md` §3 step 1 says "verify email". Should an unverified user be able to
browse and book, or only browse? My recommendation: let students book (friction
at the wallet is worse than friction at the inbox) and require verification
before a tutor can submit for review. Confirm before Phase 1.

## 7. Google sign-in and an existing password account

**Default in place:** blocked. `allowDangerousEmailAccountLinking` is `false`,
so signing in with Google using an email that already has a password account
fails rather than silently merging them.

That is the safe default and it is a slightly confusing error for a real person.
The usual fix is to link only after the user proves they own the password
account. Worth doing, but it is UI work — say if you want it in Phase 1.

## 8. Rate limiting on more than one machine

**Default in place:** in-memory, per instance, with the limits from §13.6.

On Vercel that means each lambda counts separately, so the effective limit is
higher than the number in the code. Upstash Redis is already in the §14 stack
for jobs; the same instance can back this. The interface in
`src/lib/rate-limit.ts` does not change. Needs doing before launch, not before
Phase 1.

## 9. Rounding calls

**Settled:** you kept all of these after Phase 0. Restated here so they stay
visible:

- **The commission remainder goes to the tutor.** 20% of $9.99 is $1.998; the
  platform takes $1.99 and the tutor keeps $8.00.
- **A 50% refund rounds up, in the student's favour.** Half of $9.99 refunds
  $5.00, leaving $4.99 chargeable.
- **Exactly 24 hours' notice is a 50% refund, not 100%**, and exactly 2 hours is
  50%, not 0%. The spec's bands are "> 24h", "2–24h" and "< 2h", so both
  boundaries land in the middle band.
- **A promo discounts the 30-minute rate by the same ratio as the hourly one**,
  preserving whatever relationship the tutor chose, then rounds to 50c.
- **The hold between `pending` and `available` is zero hours**, as §2 says. The
  two accounts are separate so a hold can be added later without a migration.

---

## 10. A verified tutor's edits

**Settled:** verified tutors edit freely; only a credential change sends them
back for review. Implemented in Phase 2.

## 11. Intro video length

**Settled:** the pipeline probes every upload and enforces 30–90 seconds against
the real duration. Implemented in Phase 2.

## 12. Credential files are proxied, not presigned

**Settled after Phase 1:** keep the proxy. Kept here because the reasoning still
governs the code.

**Blocks:** nothing. **Default in place:** proxied through `/api/files`.

`SPEC.md` §13.5 says "signed URLs expire in 60 seconds", which R2 can do natively
with a presigned S3 URL. I proxy instead: our route checks our own signature and
then re-checks the session before streaming the bytes.

The trade: one extra hop and our bandwidth, in exchange for the bucket hostname
never reaching a browser and access being re-checked at the moment the file is
opened. A presigned URL stays valid for its full 60 seconds even if you revoke
the admin's access a second after issuing it.

At credential-review volumes the cost is nil. If you would rather presign, it is
a contained change — `objectUrl` for the private bucket, and the route goes away.

---

## 13. Which hosted transcoder?

**Settled: neither.** You reframed the question rather than answering it, and
you were right — both bill per minute *delivered*, and a feed that autoplays a
preview on hover makes delivery scale with browsing rather than with bookings.
R2 has no egress charge.

So the pipeline now produces two fixed MP4 renditions instead of an HLS ladder:
a small muted one for card previews and a larger one for the profile hero, both
served from R2 and picked by where they are shown. `hls.js` is gone. Adaptive
streaming would earn its keep on long video; these clips are 30-90 seconds.

`SPEC.md` §14's "Mux or Cloudflare Stream" line is superseded by that reasoning,
and the reasoning is written into `src/lib/video/types.ts` so it is not
rediscovered later.

Still open: **where the transcode runs in production.** Vercel has no ffmpeg, so
a deployed environment currently stores the upload and marks it `failed` with a
message. The options are a container that has ffmpeg (Fly, Railway, a small VPS)
or a transcode-only API. This is now a smaller question than it was — no
per-minute delivery bill either way.

## 14. Transcoding runs inline

**Agreed: QStash before launch.** Recorded here as the standing decision; not
yet built.

**Default in place:** the upload's Server Action waits for the transcode.

For a 90-second clip on a local ffmpeg that is a few seconds and perfectly fine.
On a serverless function it would risk the execution timeout, and it holds a
connection open for no reason.

`SPEC.md` §14 already has Upstash QStash in the stack for jobs. The change is
small — enqueue after the upload, mark the video `processing`, and let a webhook
finish the row — and the UI already renders a `processing` state, so it is worth
doing at the same time as item 13 rather than before it.

## 15. Infinite scroll

**Agreed: cursor on `(score, tutor_id)`.** Recorded as the standing decision;
not yet built.

**Default in place:** the grid shows the first 24 with a count of the rest. The
compound cursor is what makes paging stable under a feed that reorders nightly —
`score` alone is not unique, so ties would drop or repeat rows across pages.

---

## 16. How much open time counts as "fully available"?

**Blocks:** nothing. **Default in place:** 20 hours a week
(`DENSITY_TARGET_MINUTES` in `src/lib/availability/port.ts`).

The `availability_density_next_7d` term of the ranking score is now real. It
measures how much bookable time a student searching today would actually find,
capped so that beyond the target a tutor is not scored as more findable — just
emptier.

Deliberately *not* "share of published time still free", which would have
rewarded a tutor nobody books over a busy one. Twenty hours is a guess that
reads sensibly against the seeded world; if your real tutors are mostly
part-time it should come down.

## 17. Weekly rules store both local and UTC

**Settled in practice; flagging what the code now does.**

Item 2 asked which copy is authoritative. The engine answers: **the local one**.
`expandWeeklyRules` walks calendar days in the tutor's timezone and converts
each one, which is what keeps a New York tutor's 5pm at 5pm across a DST change.

The `start_time_utc` / `end_time_utc` columns `SPEC.md` §12 asks for are still
written and still useful for coarse SQL filtering, but nothing reads them to
decide availability. If that stays true they could be dropped; leaving them
costs a little write amplification and keeps the spec's shape.

## 18. A session both people showed up for, that the connection ruined

**Settled — you chose the second option.** The platform absorbs it: the student
is refunded in full *and* the tutor is paid their full share out of platform
revenue, capped at **two per student per 90 days**. Past the cap the student is
still made whole and the tutor is not paid from our revenue.

It is the one outcome in `resolveBookingOutcome` that does not reduce to a
refund percentage, so it is the single branch that builds its own entries, and
the ledger row is named `technical_failure_absorbed` so a negative revenue line
is never a mystery. Worth watching the rate: if absorbed failures climb, the cap
is the dial, and the count is a one-line query against the ledger.

The original question, for the record:

`SPEC.md` §2 names the outcome but not who carries it. Today the student is made
whole and the tutor is paid nothing — they gave up the hour and earned zero.

On a market whose students are on mobile networks that drop, this will not be
rare. Three ways to go:

- **As now.** Simple, and the student never pays for a lesson they did not get.
  The cost lands entirely on tutors, who cannot control the student's link.
- **Split it** — refund the student in full, pay the tutor their share out of
  platform revenue. Costs us real money on every bad connection, and someone
  will notice that.
- **Pro-rate** on the overlap that did happen: twenty minutes of a sixty-minute
  lesson pays a third. Fairest on paper, most arguable in practice, and it makes
  a partial refund the common case rather than the exception.

My recommendation is the first until there is data, then revisit with the actual
rate in front of us. `resolveBookingOutcome` is the only place it would change.

## 19. Nobody can raise a dispute yet

**Built.** Either side can report a problem during the 24 hours after a session.
It moves the booking to `disputed`, which stops settlement by construction —
`disputed` is not a status `findBookingsAwaitingSettlement` looks for. An admin
resolves it at `/admin/moderation`, settling as it stands or refunding the
student, and either decision writes an `admin_audit` row with a reason.

Two of the four questions below are still open: **how long the window really
is** (24 hours is what the spec says, and a student in another timezone may
sleep through most of it), and **what evidence an admin should be shown** —
today they see the reason and the session, not the `session_events` timeline
that would settle most of these without argument.

The original question, for the record:

Escrow is held for twenty-four hours "in case anything went wrong" — and for
those twenty-four hours there is no way for anyone to say that something did.
Settlement then releases the money automatically. Before real money runs through
this, decide:

- who may open a dispute — the student only, or the tutor too
- whether opening one **pauses** settlement (it should, and that is a one-line
  addition to `findBookingsAwaitingSettlement`) or merely flags it after the fact
- who resolves it, and against what evidence: `session_events` shows exactly who
  was in the room and when, which settles most of these without argument
- how long the window really is. Twenty-four hours is what the spec says; a
  student in a different timezone may sleep through most of it.

## 20. Where LiveKit runs

**Instrument built; the reading has not been taken.** `pnpm measure:regions`
times TCP and TLS handshakes to each candidate region — Dubai first, then
Bahrain, Mumbai, Frankfurt, Singapore — takes a median over N samples, and ranks
them.

**It cannot produce a valid reading from the sandbox this was built in.**
Outbound traffic there goes through a local egress proxy, so every region
measures about 4ms and the ranking describes the proxy rather than the
geography. Publishing that number would have been worse than publishing none.

What is needed is someone running it **from the market**: a laptop in Karachi, a
phone on Jazz or Zong, a machine in Dubai. Ten minutes of somebody's time, and
then this decision is made on numbers. Until then Dubai remains the reasonable
guess, and a guess is what it is.

The original question, for the record:

The media path is the product here. Two choices, and they are not equivalent for
this market:

- **LiveKit Cloud.** No servers to run, but the nearest regions to Karachi and
  the Gulf are Mumbai, Dubai and Frankfurt. A Karachi tutor and a Karachi student
  would have their audio routed through another country and back. Billed per
  participant-minute, so cost scales with lessons taught, which at least matches
  revenue.
- **Self-hosted**, on a VPS in Karachi, Dubai or Singapore. One box runs a lot of
  one-to-one audio. Cheaper at volume, and the round trip is domestic. It is a
  server somebody has to keep alive during lessons, and it needs a TURN server
  for students behind restrictive networks.

Nothing in the codebase prefers either — the only coupling is three environment
variables and a webhook URL. But TURN, and whether a fallback region exists when
one is down, are worth settling before a launch date rather than after.

## 21. How long we keep the raw webhook payloads

**Settled — 90 days, then the body goes and the event stays.** A daily cron at
`/api/cron/retention` nulls `session_events.raw` past the window.

Deliberately an `update` and not a `delete`: what remains — which event, whose,
when, and the provider's id — is everything `summariseAttendance` computes from,
so a five-year-old booking can still be explained. What goes is the payload,
which is only useful while a dispute is live, and the dispute window is a day.

The original question, for the record:

Every LiveKit webhook is stored whole, which is what lets a dispute be answered
from evidence rather than memory. It also means participant identities, IP-level
metadata and connection details accumulate indefinitely.

A sensible shape would be: keep the derived join/leave rows for as long as the
booking's financial record, and drop `raw` after the dispute window plus a
margin — ninety days, say. Say what your retention policy should be and it is a
one-line job.


## 22. Tutors have twelve hours to answer, and only an in-app bell to hear it

**Blocks:** nothing today; blocks trials working outside a demo. **Default in
place:** an in-app notification and a card on `/tutor`.

A trial request expires twelve hours after it is made. Until Phase 7 wires up
Resend, the only way a tutor learns about one is by opening the site — so a
tutor who teaches on Monday and looks at Tutorly on Wednesday will watch every
request expire without ever seeing it, and the student is told nothing except
that their one free trial with that tutor is now used up (see item 3).

Three ways out, and they are not exclusive:

- pull the email template for `trial_requested` forward from Phase 7; it is one
  template, and the row it would send from already exists
- lengthen the response window for tutors with no recent activity
- stop the clock: let a request sit until the two-hour cutoff before the slot,
  however far away that is, rather than dying twelve hours in

Whichever you pick, decide it before real tutors are relying on trials for
supply.

## 23. What counts as answering a message

**Blocks:** nothing. **Default in place:** the median gap between a student
writing and the tutor's first reply, with silence past 24 hours counted as a
reply at the ceiling (`src/lib/messaging/response-time.ts`).

Two judgement calls in there are worth your eye, because they decide the
"Responds in <1h" badge and 10% of the ranking score:

- **Silence counts.** A student message left unanswered for a day is recorded as
  a 24-hour reply rather than ignored. Without that, a tutor who answers nobody
  has no data points at all and scores the same neutral midpoint as a tutor with
  no messages yet — silence would rank better than a slow answer.
- **A burst is one wait.** Four messages from a student, then one reply, counts
  once, timed from the first of them. The alternative — timing from the last —
  would let a tutor look fast by waiting for someone to finish typing.

Neither is obviously right. They are, at least, in one pure module with tests
rather than spread through a query.

## 24. Masking cannot catch a number written in words

**Blocks:** nothing. **Default in place:** patterns for emails, phone numbers,
handles and messaging-app links, plus the raw text kept for moderation.

`maskContactInfo` is deliberately conservative — it would rather hide a long
order number than let a phone number through — but "oh three double oh, one two
three four five six seven" goes straight past it, and so does "my handle is my
first name and my birth year". There is a test that documents exactly that.

The moderation queue is the answer for now: every message the masker touched is
listed, worst first, with what was typed beside what was shown. If off-platform
leakage turns out to matter more than that, the next step is a classifier on the
raw text rather than more regexes — but that is a real cost, and worth deciding
with numbers rather than in advance.

**Since Phase 6C** there is a second layer next to this one:
`scoreContactIntent` estimates whether somebody *meant* to pass contact details,
which is a different question from whether a pattern matched. It still cannot
read "oh three double oh" — see item 28 on why that is accepted rather than
fought — but "cheaper if we do it directly" now reaches a human without any
number being typed at all.


## 25. Commission is retention-based now, and the negotiated rate is a floor

**Settled, and a change to SPEC.md §2 rather than an implementation of it.**

The spec said commission was a per-tutor rate, 20% by default, 15% for early or
high-volume tutors. It is now **retention-based**: 20% on a student's first paid
booking with a tutor, 15% on every one after. Keeping a student is worth more to
us than acquiring one.

`tutor_profiles.commission_bps` did not become dead — it is a **floor**. The
effective rate is the lower of the negotiated rate and the retention rate, so a
tutor recruited on 12% pays 12% whichever session it is, and the column's
default of 2000 means the floor never binds for anybody who negotiated nothing.
That keeps recruitment able to offer a rate without that offer quietly costing
the tutor their retention discount.

Two consequences worth keeping an eye on:

- **The rate turns on a session that actually happened**, not one that is
  booked. A student who books two sessions in one sitting pays the first-booking
  rate on both, because the first has not happened yet when the second is
  created. That is the strict reading of the rule and it is what the code does;
  if it feels wrong in practice, the change is one line in
  `hasCompletedPaidSession`.
- **A tutor's effective rate is now visible to them** on their own page, as two
  numbers rather than one. If sales wants to quote a single figure during
  recruitment, that figure is the floor.

The old per-tutor snapshots on existing bookings are untouched and still mean
what they meant.

## 26. Which classes line up with which, across boards

**Settled.** The mapping below is right, and tier 1 stays the weakest tier.

A class only means something inside its board, so a match across boards needs a
board-independent rung to compare on. Every level carries one:

| Stage | CAIE / Edexcel | Punjab / Federal | CBSE | IB | AP |
|---|---|---|---|---|---|
| Lower secondary | Year 9, Year 10 | Class 9 | Class 9 | MYP 4 | Grade 9 |
| Upper secondary | IGCSE, O Level, GCSE | Class 10 (Matric) | Class 10 | MYP 5 | Grade 10 |
| Advanced, first year | AS Level | Class 11 (FSc I) | Class 11 | DP 1 | Grade 11 |
| Advanced, final year | A2 Level | Class 12 (FSc II) | Class 12 | DP 2 | Grade 12 |

**Your answer, which the code now carries:** FSc Part I is *not* equivalent to
AS Level. It is Class 11, taken at 16-17, broader and more memorisation-heavy.
Content overlaps in maths and physics, but exam technique is completely
different — and exam technique is a large part of what a student is paying a
tutor for.

So the rung is right (nearer AS than A2, which is where age puts it) and the
tier is right (1, the weakest), and it is deliberately never promoted above
that. The reasoning is written into `src/lib/curriculum/boards.ts` and
`match.ts` so the next person to look at the table does not "fix" it.

Changing a rung is one column: `curriculum_levels.stage`, editable from
`/admin/curriculum`.

**Also settled, and worth disagreeing with if you do:** the catch-all "Other /
not listed" board never earns a near match. Two people who both picked it have
told us nothing they have in common, so pairing them would be inventing a match
out of an absence.

## 27. How much a workable hour is worth against a rating

**Settled.** Up to 1200 basis points, earned in full at **three** overlapping
hours, graduated all the way down.

The feed now adds a timezone-overlap bonus to the nightly score: a tutor whose
free hours land in the student's evening ranks above one whose land at 3am. The
two numbers behind it are judgement calls:

- **`OVERLAP_MAX_BPS = 1200`** — a twelfth of the score range, and more than the
  ~225 points between a 4.6 and a 4.9 tutor. So being reachable outranks three
  tenths of a star. That feels right for live tutoring and would be wrong for
  almost any other kind of marketplace.
- **`OVERLAP_TARGET_HOURS = 3`** — was six, which was measured against a world
  where tutor and student share a working day. The actual market does not:
  Lahore to London is a five-hour offset, so a London tutor teaching their own
  evening shares barely an hour with a Karachi student's day, and a bar that
  fails that pair fails the corridor this product is for. Three passes it.

The term is **graduated, not a threshold**: one shared hour earns a third of it
rather than falling off a cliff, because one shared hour is one lesson a week
that actually happens. Only genuinely no shared hour scores nothing.

And it can never overturn a curriculum match, because the match tier is a
separate leading key: a tutor teaching the exact board, class and subject with
two workable evening hours stays above a tutor with neither, whatever the term
returns. That is asserted in `src/lib/curriculum/ordering.test.ts` rather than
left as an arithmetic coincidence.

Both numbers are in `src/lib/ranking/overlap.ts` and both are one-line changes.

A tutor who has published no hours at all scores the midpoint rather than zero,
because an empty calendar is missing information and not a bad tutor. That one I
would not change.


## 28. There is no ban on the ladder, and that is on purpose

**Settled.** Warning, then a restriction on *new* students, then human review.
Nothing automatic at any rung, and no rung that takes an existing student away.

The obvious design is: detect a phone number, ban the account. It fails twice.

It fails on **precision**. "Question 15 on page 240" and "x = 03" are, to a
pattern, a run of digits — and being wrong once, mid-lesson, costs a lesson and
a tutor who stops trusting the product. That is why
`src/lib/messaging/contact-intent.ts` scores rather than decides, and why the
first block of its test file is a list of ordinary teaching that must come out
at zero.

It fails on **strategy**. A tutor with fifteen regular students who gets banned
does not stop teaching those fifteen. They move to WhatsApp, which is the exact
leak the platform exists to close: the ban completes the disintermediation
instead of preventing it.

So a restriction removes `new_trial_requests` and the ranking boost, and takes
15% off the ranking score (`RESTRICTION_PENALTY_BPS`) — a demotion, not a
delisting. Existing students, bookings, threads and money are untouched, and
`/settings/notices` says so in those words. Every notice is appealable,
including a warning, because a process with no way back only ever gets more
severe.

**Where the judgement is:** `RESTRICTION_DAYS = 30` and
`RESTRICTION_PENALTY_BPS = 1500`, both in one place each. If leakage turns out
to be worse than this handles, the honest next move is a shorter ladder, not a
harsher bottom rung.

**And the part worth saying out loud:** determined evasion wins. "My name on
Instagram is my first name and my birth year" defeats all of this and always
will. The ladder is for the ordinary case — somebody who has not thought about
it — and the durable fix is the platform being worth staying on.


## 29. Where the confidence thresholds sit

**Settled, and the numbers are arguable.** 25 / 50 / 75 out of 100, with a
nine-digit floor before a run of numbers counts as phone-shaped at all.

- Below 25 the composer says nothing. Silence is the correct response to a
  message that is not about contact details.
- 25 to 74 shows a hint before sending and goes no further. Somebody who reads
  it and sends anyway has made a decision, which is a better thing for a
  reviewer to be looking at than a blocked message.
- 75 and above writes a row in `contact_flags`. That is the *entire* automatic
  response: the message is already sent, and stays sent.

Two calls inside the scorer matter more than the thresholds:

**Nine digits, not seven.** The masking layer uses seven and errs towards
hiding — right, because the cost of over-hiding is one awkward message. This
layer decides whether to spend a person's attention, and a queue full of
"do 1 2 3 4 5 6 7" is a queue nobody reads.

**Dampening is by adjacency, not by message.** The word that says what a number
means is the one next to it. `page 240` is a page; `whatsapp me on 0300 1234567`
is a phone number; a message with both has one of each. An earlier version
looked at a thirty-character window and let a "question 15" three clauses away
excuse a real number.

`payment_evasion` — "cheaper if we do it directly", "no commission" — is alone
worth the whole threshold, because nobody types it by accident while teaching.


## 30. What a credit pack is actually worth

**Settled.** Cash in, minus the payment provider's cut, minus what the credits
will cost in tutor pay at the **blended** take rate.

Reporting a pack's margin as its price is how a marketplace convinces itself a
bonus tier is free. A pack is a promise of tutoring, and the tutoring costs
whatever the tutor keeps — bonus credits included, which is exactly what makes
a generous tier expensive.

The tutor's share is read from settled bookings (revenue ÷ GMV) rather than
from the headline 22/16, because the headline would flatter every row while
old 15% and 20% sessions are still settling.

On the current seed this puts the $5 first-lesson pack around **6%** and the $25
Standard around **13%**. The gap is almost entirely the fixed 50c a card costs,
which a $5 purchase cannot absorb and a $25 one barely notices. That is the
argument for the local wallets, in one row of a table.

Provider fees are summed per purchase, not per dollar: a fixed 50c across
twenty $5 packs is $10, not 50c.


## 31. When a quiet pair means something

**Settled, and it is a signal rather than a finding.** Three settled sessions,
then **thirty** days of silence, and the student has not booked anyone else
here in the meantime. All three clauses, together.

Thirty rather than forty-five because of item 32: in a market whose normal
shape is a monthly commitment, a pair that misses a whole month has not gone
on holiday. Forty-five days was calibrated against ad-hoc hourly booking, which
is not what this market does.

One quiet pair is a student who passed their exam. The number that means
something is the **ratio per tutor**: eleven quiet against two still active is a
pattern, and a tutor with a hundred students will always have more quiet pairs
than one with five.

The "and not booking anyone else" clause is what separates disintermediation
from ordinary churn — a student who moved to a different tutor here has not
left, and counting them would make every popular tutor look guilty.

`QUIET_AFTER_SESSIONS` and `QUIET_DAYS` are in `src/db/reports.ts`. Nothing
acts on the output: it is a table on the moderation page, to be read beside the
tutor's messages and reviews by somebody who then decides.


## 32. What the market actually sells is a month, not an hour

**A real quote, and it changes the shape of the product.** A Lahore tutor:
**50,000 PKR a month for three sessions a week across two subjects** — about
**$13.70 an hour** once you divide it out.

The rate is the least interesting part of that. The structure is the point:

- **It is a commitment, not a transaction.** The student is not deciding
  whether to book Tuesday. They decided once, and Tuesday happens. A product
  that makes them decide every week is asking a question the market has already
  answered, and losing a little of the relationship every time it asks.
- **It is multi-subject.** Two subjects with one tutor, not two tutors. The
  curriculum position a student declares is not one row.
- **It is priced by the month**, which is how the tutor thinks about their
  income and how the parent thinks about the bill.

What follows from it, and what deliberately does not:

**Recurring series exist because of this.** "Same time every Tuesday and
Thursday" is one decision, made once — the shape the market already has.

**But the money still moves per session.** This is the one place the product
deliberately does *not* copy the market. Taking 50,000 PKR up front would mean
holding a month of somebody's money against tutoring that has not happened, on
a platform they have used twice. Every session is charged at its own T-48h,
with a warning at T-72h if the wallet cannot cover it, and an occurrence that
cannot be paid for **lapses visibly** rather than vanishing.

So the series is the commitment and the ledger is per session. The tutor gets
the predictability — the slot is reserved, one-off bookings cannot take it —
without the platform holding a float it has not earned. If tutors turn out to
want the monthly certainty badly enough to price for it, the honest version is
a *discount* on a committed series, not a prepayment.

**$13.70/hour sits in the middle of the current price band**, which runs from
$5 to $200. That is the right place for the anchor to land, and it is worth
re-checking once there is real supply: if the launch market clusters at $10-15
and the band's top half is empty, the band is wrong, not the market.