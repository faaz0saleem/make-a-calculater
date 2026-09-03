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

## 10. Should a verified tutor's edits go back through review?

**Blocks:** nothing yet. **Default in place:** a verified profile is read-only in
the wizard; only `draft` and `rejected` can be edited.

That is safe but blunt: a verified tutor cannot fix a typo in their bio without
an admin. The status machine allows `verified → suspended` and nothing else, on
purpose, so the choice is yours:

- let verified tutors edit freely, and re-review only when a *credential*
  changes (my recommendation — the risky field is the document, not the bio)
- let them edit everything and drop back to `pending_review`, losing feed
  visibility until an admin looks again
- keep it as it is, and add an admin "unlock for editing" action

## 11. Intro video length is not enforced yet

**Blocks:** nothing. **Default in place:** the 30–90 second rule is checked only
once a duration is known, and nothing measures one yet.

Phase 1 stores the uploaded file and marks it ready; Phase 2 transcodes it and
will fill in `videos.duration_s`, at which point the rule starts biting. A tutor
verified in the meantime could have a 5-second or a 10-minute intro.

If that matters before Phase 2, the cheap fix is a client-side duration check on
upload — easy to bypass, but it catches honest mistakes. The real fix is the
transcode step. Tell me if you want the stopgap.

## 12. Credential files are proxied, not presigned

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
