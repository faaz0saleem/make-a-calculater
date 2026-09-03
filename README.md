# Tutorly

A discovery-first tutoring marketplace.

Verified tutors set their own 60- and 30-minute rates. Students buy credits
($10 / $25 / $50 / $100 packs, 1 credit = $1) and spend them on booked sessions.
Every lesson happens on-platform over video or voice. Tutors can offer a short
free trial they approve by hand, and cash out by bank transfer once their
balance reaches $100.

Browsing is meant to feel like YouTube — an infinite grid of tutor cards with
autoplaying intro videos, category rails and a "continue with your tutors" row —
not like a directory table.

[`SPEC.md`](./SPEC.md) is the source of truth for the product and the data model.
[`PROGRESS.md`](./PROGRESS.md) says what is built right now.
[`DECISIONS_NEEDED.md`](./DECISIONS_NEEDED.md) lists the questions that are
genuinely blocked on a human.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict |
| Database | Postgres (local, Neon or Supabase — it is plain Postgres) |
| ORM | Drizzle + drizzle-kit migrations |
| Auth | Auth.js v5 — email/password and Google |
| UI | Tailwind v4 + shadcn/ui tokens |
| Video | LiveKit Cloud *(phase 4)* |
| Storage | Cloudflare R2 — private bucket for credentials, local filesystem in dev |
| Email | Resend *(phase 7)* |
| Tests | Vitest for the pure logic, Playwright for the journeys |
| Hosting | Vercel |

Payments are deliberately not tied to a provider. Everything goes through a
`PaymentProvider` interface with a `MockProvider` that credits the wallet
instantly in development; the real one drops in behind it once chosen.

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

---

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
booking that already exists.

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
   encrypted by the application with AES-256-GCM, not just by the disk.
8. Double-booking is impossible at the database level — a partial unique index
   on `(tutor_id, start_at_utc)` over live statuses, plus a transaction wrapping
   the slot check, the debit and the insert.

---

## Layout

```
src/
  app/                  routes — home, auth, dashboard, tutor, admin, api
    tutor/onboarding/   the ten-step wizard and its server actions
    admin/verification/ the review queue and the approve / reject screen
    api/files/          private objects, behind a 60-second signature
  auth.ts               Auth.js: credentials + Google, Node runtime
  auth.config.ts        the edge-safe half, used by middleware
  components/           UI primitives and the wizard's step forms
  db/
    schema.ts           the whole schema from SPEC.md §12
    ledger.ts           the only writer of balance columns; reconciliation
    tutors.ts           every query that decides who is visible
    seed.ts             the development world
    seed-assets.ts      generated PNGs and PDFs, so no binaries are committed
    migrate.ts
  lib/
    admin/audit.ts      the admin_audit writer
    auth/               password policy, roles, server-side guards
    bookings/status.ts  the booking state machine
    money/              cents, pricing, outcomes, ledger drafts, packs, payouts
    storage/            object stores, keys, signed URLs, upload checks
    tutors/             profile status machine, wizard model, visibility rules
    crypto.ts           AES-256-GCM for payout details
    time.ts             IANA timezone conversion
    rate-limit.ts
e2e/                    Playwright journeys
drizzle/                generated SQL migrations
```

Unit tests sit next to what they test, as `*.test.ts`. They are pure and need no
database, so `pnpm test` runs anywhere. The journeys in `e2e/` need a database
and a built app, and run with `pnpm e2e`.
