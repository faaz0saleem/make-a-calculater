# Progress

Phases follow `SPEC.md` §15.

| Phase | Status |
|---|---|
| 0 — repo, schema, migrations, auth, seed | **Done** |
| 1 — tutor onboarding wizard + admin verification queue | Not started |
| 2 — discovery feed, search, filters, tutor profile | Not started |
| 3 — availability engine + booking + credits | Not started |
| 4 — LiveKit calls + session state machine + settlement | Not started |
| 5 — trials, messaging, reviews, follows | Not started |
| 6 — payouts + admin dashboard + audit log | Not started |
| 7 — real payment provider, notifications, SEO, analytics | Not started |

---

## Phase 0 — done

### The money layer, written first and tested before any UI

- `src/lib/money/cents.ts` — integer-cent arithmetic. Every division lives here
  with an explicit rounding rule. `assertInt` rejects floats outright.
- `src/lib/money/pricing.ts` — `priceForBooking`, `applyCommission`,
  `deriveHalfHourCents`, the $5–$200 hourly bounds, the 40%–70% half-hour band,
  and promo handling that discounts the 30-minute rate by the same ratio.
- `src/lib/money/outcomes.ts` — `resolveBookingOutcome(booking, attendance)`.
  Every row of the cancellation and no-show table in `SPEC.md` §2 has a test,
  plus the boundaries between rows (exactly 24h, exactly 2h, exactly 50%
  attendance, exactly ten minutes of waiting).
- `src/lib/money/ledger.ts` — the entry builders. Internal groups are asserted
  to net to zero; purchases and paid payouts are marked external because value
  crosses the system boundary.
- `src/lib/money/payouts.ts` — the $100 threshold and the payout state machine.
- `src/db/ledger.ts` — `appendLedger` (idempotent: a replayed key inserts
  nothing and moves no balance) and `reconcileLedger`, the nightly job.

### Schema and migrations

All 27 tables from `SPEC.md` §12, plus two additions noted in
`DECISIONS_NEEDED.md`. Generated migration in `drizzle/`. The indexes that carry
weight:

- `booking_no_overlap` — partial unique on `(tutor_id, start_at_utc)` where
  status is `pending_tutor`, `confirmed` or `in_progress`.
- `one_trial_per_pair` — partial unique on `(student_id, tutor_id)` where
  `is_trial = true`.
- `ledger_entries_idempotency_key`, `credit_purchases_idempotency_key` — unique.
- `users_email_lower_key` — unique on `lower(email)`.

### Auth

Auth.js v5 with email/password (bcrypt cost 12, constant-time on a miss) and
Google. Roles are a `user_role[]` set, so one account can be both a student and
a tutor. Sessions are JWTs; roles are re-read from the database when the token
does not carry them, so a suspension takes effect without waiting for expiry.

`/api/auth/register` will only ever grant `student` or `tutor`. `admin` is not
self-assignable. Rate-limited to 5 attempts per minute per IP.

### Seed

`pnpm seed` truncates and rebuilds, deterministically:

- 40 verified tutors across 10 timezones, with varied rates, subjects,
  availability patterns, ratings and commission rates
- 5 tutors in `pending_review` with credentials waiting in the admin queue
- 10 students with credit balances from settled mock purchases
- 222 bookings — settled, cancelled, no-show, upcoming and pending trials
- reviews on roughly two thirds of completed sessions
- the three payout fixtures from `SPEC.md` §16

Every balance is built by appending real ledger entries. The seed then asserts
no balance is negative, that the ledger conserves (entries sum to purchases
minus payouts), and runs the reconciler.

### Verified by hand against a running build

- All three roles sign in; a wrong password produces no session.
- Signed out, `/dashboard` and `/admin` redirect to sign-in. Signed in without
  the role, they redirect to `/dashboard` rather than looping through sign-in.
- Registration: 201 for a new student and a new tutor, 409 on a duplicate email,
  400 on a weak password, 400 on `intent: "admin"`, 429 on the sixth attempt in
  a minute from one IP.
- Injecting `+137` into a wallet column makes `pnpm reconcile` fail and name the
  balance, the ledger total and the drift. Removing it makes it pass again.

---

## What is stubbed

Nothing is a `TODO` standing in for logic. These are pieces later phases own:

| Piece | State |
|---|---|
| `PaymentProvider` | Not written yet. Purchases exist in the schema and the seed writes settled ones through the ledger; the interface and `MockProvider` land with Phase 3 checkout. |
| Home feed | A plain grid of the 40 seeded tutors, ordered by the ranking table. No video, autoplay, rails, search or filters — that is Phase 2. |
| `tutor_ranking` | Populated by the seed with the Bayesian rating only. The weighted score from `SPEC.md` §4 is Phase 2. |
| Tutor onboarding | `/tutor` shows status, rates and balances. The 10-step wizard is Phase 1. |
| Admin | Read-only: queues, metrics and the live reconciliation. Approve, reject and pay buttons — and their `admin_audit` rows — are phases 1 and 6. |
| Intro videos, avatars, credential files | Seeded as URLs and object keys. R2 upload and signed URLs are Phase 1. |
| LiveKit, messaging, notifications | Schema only. Phases 4, 5 and 7. |
| Playwright | Not set up. It arrives with the Phase 3 booking journey, which is the first thing worth driving end to end. |
| Rate limiting | Real, but in-memory, so it is per instance. Needs a shared store before running on more than one node. |

---

## Commands to run

```bash
pnpm install
cp .env.example .env.local     # fill in DATABASE_URL, AUTH_SECRET, PAYOUT_ENCRYPTION_KEY

pnpm db:migrate
pnpm seed

pnpm typecheck && pnpm test && pnpm build
pnpm reconcile

pnpm dev                       # http://localhost:3000
```

Sign in with `admin@tutorly.test`, `tutor@tutorly.test` or `student@tutorly.test`,
password `tutorly-dev-2026`.

### Last full run

```
pnpm typecheck   clean
pnpm test        10 files, 143 tests passed
pnpm build       compiled, 10 routes
pnpm seed        56 users · 40 verified tutors · 5 pending · 222 bookings
                 108 reviews · 1,559 ledger entries · zero drift
pnpm reconcile   Ledger reconciled: 1559 entries, zero drift.
```
