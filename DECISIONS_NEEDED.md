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
status condition. Say which you want before trials ship in Phase 5.

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

## 5. Two tables beyond SPEC.md §12 — confirm you are happy

**Default in place:** both exist.

- `platform_accounts` — `platform_revenue` had no materialised home. Without it
  the reconciler cannot check the platform's own balance, only everyone else's.
- `credit_packs` — §2 says packs are "configurable in admin" and
  `credit_purchases.pack_id` implies a row to point at. Seeded from the
  constants in `src/lib/money/packs.ts`.

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

## 9. Rounding calls I made — say if you disagree

None of these are in the spec, and all are testable one-liners to change:

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
