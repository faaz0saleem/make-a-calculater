# Money audit

Everything in this system settles automatically and nothing has ever moved a
real rupee. This is the deliberate look at the paths that cannot be wrong,
before anybody's money is in them.

Six questions were asked. Each one is answered below with what was actually
read, what was actually run, and what was found — including the ones where the
answer is "no path exists", because a pass with no reasoning behind it is
indistinguishable from a pass nobody checked.

**Four defects were found and fixed.** One of them had been shipping wrong
numbers to students since Phase 2.

| | Question | Verdict |
|---|---|---|
| Q1 | Escrow without a ledger entry, or the reverse | **No path exists.** Structural. |
| Q2 | Partial writes from an early return, throw or catch | **One defect.** A materialised column moved twice per purchase. Fixed. |
| Q3 | Connection-failure absorption triggered twice for one booking | **No path exists.** |
| Q4 | A cancelled or rescheduled occurrence still charged at T-48h | **One defect.** A microsecond race in the status read. Fixed. |
| Q5 | Two concurrent payout requests locking more than the balance | **Cannot happen.** Proved with eight parallel clients. |
| Q6 | A booking refunded twice through two routes | **No path exists** for the money. **One defect** in how a second attempt reported itself. Fixed. |

Plus a fourth fix that is not one of the six: settlement now locks the booking
row and refuses to run against one that is already settled (Q2).

---

## Q1 — Is there any path where escrow is debited and no ledger entry is written, or the reverse?

**No, and it is structural rather than careful.**

`bookings.escrow_cents` is written in exactly one place in the codebase:

```
src/db/ledger.ts, applyToMaterialisedBalance(), case 'escrow'
```

That function is private to the module and is called from one place —
`appendLedger`, once per ledger row that was genuinely inserted. There is no
other `set({ escrowCents: … })` anywhere; the only other mentions of the column
are `select`s for the admin float, the metrics query and the seed. So the
column cannot move without a row, because the row is what moves it.

The reverse — a row with no column movement — is prevented by the same call
site plus a guard: an `escrow` entry without a `booking_id` throws rather than
writing a row nobody can attribute.

The two directions are also asserted from the outside, nightly. `reconcileLedger`
compares `sum(delta_cents) where account = 'escrow' group by booking_id`
against `bookings.escrow_cents` with a **full outer join**, so a booking with a
column and no rows, and rows with no booking, both surface as drift.

**What was actually checked.** Every write to every materialised money column,
by grep, not by memory:

| Column | Written in |
|---|---|
| `bookings.escrow_cents` | `src/db/ledger.ts` only |
| `tutor_profiles.pending_cents` | `src/db/ledger.ts` only |
| `tutor_profiles.available_cents` | `src/db/ledger.ts` only |
| `tutor_profiles.payout_locked_cents` | `src/db/ledger.ts` only |
| `platform_accounts.balance_cents` | `src/db/ledger.ts` only |
| `student_wallets.credits_cents` | `src/db/ledger.ts` only |
| `student_wallets.lifetime_purchased_cents` | **two places.** See Q2. |

Test fixtures are the exception and are deliberate: `src/db/seed.ts` builds its
world through `appendLedger` like everything else, and `e2e/helpers.ts`
`grantCredits` writes a purchase, a ledger row and the columns by hand so that
`pnpm reconcile` still passes after an e2e run.

---

## Q2 — Does any early return, thrown error or caught exception inside a money transaction leave a partial write?

**One defect, and it was the seventh column in the table above.**

### The rule that makes the answer checkable

A Drizzle transaction callback that **returns** a value *commits*. Only a throw
rolls back. So "does an early return leave a partial write?" reduces to one
mechanical question per transaction: **is every early return before the first
write?**

Every money transaction was read with that question:

| Transaction | Early returns | Verdict |
|---|---|---|
| `createBooking` | 6 (`no_such_tutor`, `not_bookable`, `insufficient_credits`, `slot_taken`, `not_available`) | All before the first `insert`. Safe. |
| `createSeries` | 5 | All before the first `insert`. Safe. |
| `requestPayout` | 4 (missing profile, unverified email, ineligible, no method) | All before the `insert into payouts`. Safe. |
| `applyPaymentEvent` | 1 (`replay`) | After `appendLedger`, which by definition wrote nothing on that branch. Safe. |
| `cancelBooking` | 0 inside the transaction | Safe. |
| `settleBooking` | 0 inside the transaction | Safe. |
| `resolveDispute` | 1, added by this audit | The claim is the first write; returning after it commits a no-op. Safe. |
| `acceptInvite` | 1 (`claimInvite` lost the race) | Returns `null` before the `insert into users`, which is why a lost race leaves no orphan account. Safe. |

### The defect

`student_wallets.lifetime_purchased_cents` was moved **twice on every credit
purchase**.

`applyToMaterialisedBalance` bumps it whenever a `student_credits` entry
carries a `purchase_id` and a positive delta — which is exactly what a purchase
is. `applyPaymentEvent` then bumped it again, in the same transaction, by the
same amount.

Not a partial write; a doubled one. It is in this section because it is the
same failure mode: a money column moved outside the one file allowed to move
it, in a transaction whose other half was already moving it.

**Proved rather than reasoned about.** A purchase of 2,500 cents was driven
through `applyPaymentEvent` against the real database:

```
settle result : { applied: true, reason: 'credited', creditsCents: 2500 }
credits moved : 2500 (expected 2500)
lifetime moved: 5000 (expected 2500)
```

**Impact.** `lifetime_purchased_cents` is not spendable and gates nothing — the
one-per-person first-lesson pack is decided by counting purchase *rows*, not by
this column. Its only reader is the line on a student's dashboard telling them
what they have spent with us, which has been telling every student since Phase 2
that they have spent twice what they have. Small, and precisely the kind of
wrong number that destroys trust when somebody notices.

**Why nobody noticed for nine phases.** It was the one materialised money column
outside `reconcileLedger`. Six accounts were reconciled nightly; this one was
not, so nothing ever compared it to the ledger.

**Fixed, in two parts.**

1. The duplicate write in `applyPaymentEvent` is gone. `src/db/ledger.ts` is
   again the only file that moves a `_cents` column, which was always the rule
   at the top of that file.
2. `lifetime_purchased_cents` is now the seventh reconciliation check, compared
   against `sum(delta_cents) where account = 'student_credits' and purchase_id
   is not null and delta_cents > 0`. Being outside the reconciliation is how
   this survived; the fix is not to be more careful, it is to be checked.

The e2e `grantCredits` helper was moving only one of the two columns and now
moves both, so the new check does not report drift the moment a test runs.

**No production data to repair.** Nothing has launched. If it had, the repair
would be a single `update` from the ledger, and `pnpm reconcile` would now be
the thing that found it.

---

## Q3 — Can the connection-failure absorption path be triggered twice for one booking?

**No.**

Absorption is a branch inside `resolveBookingOutcome`: when the resolution is
`technical_failure` and the platform is still inside the student's allowance,
the tutor is paid what a completed session would have paid and the money comes
out of platform revenue instead of the student.

It writes exactly one ledger row that says so:

```
account          platform_revenue
reason           technical_failure_absorbed:absorbed
idempotency_key  booking:<booking id>:settle:platform
```

The key contains the booking id and `ledger_entries.idempotency_key` is unique,
so a second settlement of the same booking inserts nothing and moves no
balance. One booking can therefore produce at most one absorption row, ever.

The allowance is then counted **from those rows**:

```sql
select count(*) from ledger_entries l join bookings b on b.id = l.booking_id
where b.student_id = $1 and l.reason = 'technical_failure_absorbed:absorbed'
  and l.at >= now() - 90 days
```

Two out of two absorptions is two distinct bookings, because one booking cannot
contribute two rows. The count cannot be inflated by a replay.

**The path that would have made this false** is a booking settling twice with
different outcomes. That is now impossible for a second reason as well — see
the settlement lock in Q2 — but it was already impossible for money: the same
key is used by settlement *and* by an admin refund, so the second writer
inserts nothing whichever route it comes from.

---

## Q4 — Can a rescheduled or cancelled occurrence still be charged at T-48h?

**Not any more. There was a race, and it was real.**

### Cancelled

The charge job selects `status = 'scheduled'` only. A cancelled occurrence is
`cancelled_by_student` or `cancelled_by_tutor` and is not selected. A lapsed one
is `lapsed`. Fine as far as it goes.

But "selects, then loops, then charges" leaves a window. The job reads a page of
occurrences, and each charge happens in its own transaction some milliseconds
later:

```ts
await database.transaction(async (tx) => {
  await moveBookingStatus(booking.id, 'confirmed', {}, tx);
  await appendLedger(tx, bookingEscrowEntries({ … }));
});
```

`moveBookingStatus` re-reads the status inside the transaction and refuses an
illegal transition, which is what stops the charge — `cancelled_by_student →
confirmed` is not a legal move, the transition throws and the transaction rolls
back with no money taken. That is the right design.

**The defect:** the re-read was a plain `select`. Under `READ COMMITTED`, a
cancellation committing between that select and the update is not seen, and the
update writes `confirmed` over a booking the student had already called off —
taking their credits for a session that is not happening. The window is
microseconds wide and needs an exact interleaving, which is why it had never
been hit. It is also the single worst outcome in this document: money taken for
a lesson somebody cancelled.

**Fixed.** The status read in `moveBookingStatus` is now `select … for update`.
The cancelling transaction and the charging transaction serialise on the
booking row, so the charge either happens before the cancel or reads
`cancelled_by_student` and throws. This closes the window for **every** status
transition in the codebase, not just this one, because every transition goes
through that function.

Outside a transaction the lock is taken and released immediately, which is
harmless; every caller that matters passes its own `tx`.

### Rescheduled

Accepting a reschedule moves `start_at_utc` and touches neither status nor
money, in a serializable transaction. A `scheduled` occurrence that moves is
still `scheduled`, and the charge job's window is computed from
`start_at_utc` — so it is charged 48 hours before the *new* time, which is
correct. There is no path where the old time's charge fires as well: there is
one row, and it has one start time.

### Occurrences already in the past

The job has no lower bound on the window, deliberately. An occurrence still
`scheduled` with its start behind us means the job did not run for two days;
those are lapsed rather than charged, because nobody paid for them and a
session in the past is not coming.

---

## Q5 — Can a tutor request twice concurrently and lock more than their available balance?

**No. Proved with parallel clients, the same way double-booking was.**

`pnpm prove:payout` fires N genuinely parallel `requestPayout` calls — separate
connections, separate transactions, all in flight at once — each asking for the
tutor's **entire** available balance. Sequential calls would prove nothing; the
question is what Postgres does when several transactions read the same balance
before any of them has written.

The mechanism is a `select … for update` on `tutor_profiles` as the first
statement inside the transaction. The second transaction blocks on the row lock
until the first commits, then re-reads a balance of zero and is refused by
`canRequestPayout`.

Eight clients, each asking for the whole $100.00:

```json
{
  "tutorEmail": "payout.ready@tutorly.test",
  "clients": 8,
  "availableBefore": 10000,
  "eachRequested": 10000,
  "succeeded": 1,
  "refusals": [
    "You need at least $100.00 available to request a payout. You have $0.00.",
    "… seven of these …"
  ],
  "availableAfter": 0,
  "lockedAfter": 10000,
  "ledgerLocked": 10000,
  "openPayouts": 1
}
```

The script asserts all five properties and exits non-zero if any fails, so it is
a check rather than a demonstration: exactly one success, locked equals the
balance, available reaches zero, the ledger agrees with the column, and one
payout row exists.

Also verified: `pnpm reconcile` reports zero drift immediately afterwards, so
the eight refused attempts left nothing behind.

---

## Q6 — Can a booking be refunded twice through two different routes?

**Not for the money — by two independent mechanisms. One defect in how the
second attempt reported itself, now fixed.**

There are four routes that can move a booking's escrow:

1. the student or the tutor cancels (`cancelBooking`)
2. the nightly settlement (`settleBooking`)
3. an admin refunds a dispute (`resolveDispute`, `refund`)
4. an admin settles a dispute as it stands (`resolveDispute`, `settle`)

### Mechanism one: they share idempotency keys

Every route builds its entries with the same keys:

```
booking:<id>:settle:escrow     booking:<id>:settle:refund
booking:<id>:settle:tutor      booking:<id>:settle:platform
```

`adminRefundOutcome` uses the *same* keys as `resolveBookingOutcome` on purpose.
So a booking that has been through any one route inserts nothing on a second,
whatever the second route thinks the refund should be. The money cannot move
twice even if every other guard fails.

### Mechanism two: the state machine

Each route also has a status precondition, and the terminal states have no
outgoing transitions at all:

| Route | Requires | After a cancel (`cancelled_by_student`) |
|---|---|---|
| `cancelBooking` | `pending_tutor` or `confirmed` | refused: `not_cancellable` |
| `settleBooking` | selected only from `confirmed`, `in_progress`, `completed`, `no_show_*` **with `settled_at is null`** | not selected |
| `openDispute` | `settled_at` null and a disputable status | `cancelled_by_student → disputed` is illegal |
| `resolveDispute` | an open report on a `disputed` booking | unreachable, because the dispute cannot be opened |

A settled booking cannot become disputed, so an admin cannot refund something
the nightly job has already settled. A disputed booking is never picked up by
the nightly job, so an admin decision cannot race the cron.

### The defect

Two admins pressing "refund" on the same report at the same moment — or one
admin pressing twice — both read the report as `open`, because the read was
outside the transaction that resolved it. The money was safe (mechanism one),
and the second attempt then hit an illegal transition and threw. The admin saw
a server error instead of "somebody already handled this".

Worse in principle: the money moved in one transaction and the report closed in
a second one. A process dying between them left the credits refunded and the
report still open.

**Fixed.** `resolveDispute` is now a single transaction that claims the report
first:

```sql
update reports set status = 'resolved', resolved_at = $now
where id = $id and status = 'open' returning id
```

If that returns nothing, the transaction returns `not_found` before writing
anything else. If it returns a row, the money movement and the audit entry
happen in the same transaction, so the report and its consequence commit
together or not at all.

---

## What this audit did not cover

Said plainly, because an audit that implies more than it did is worse than a
shorter one:

- **No real payment provider has ever been in these paths.** Every purchase in
  every run above went through `MockProvider`, which posts the same signed
  webhook to the same route a real one would. What is proven is our handling of
  a payment event, not our handling of JazzCash.
- **The concurrency proofs run against one Postgres on one machine.** Row locks
  and serializable retries behave the same on a managed instance, but latency
  does not, and a lock held across a slow network is a lock held longer.
- **`reconcileLedger` compares columns to the ledger. It does not compare the
  ledger to a bank.** Nothing does yet, because no money has left the system.
  The first real payout is the first time those two numbers can disagree.
- **The absorption allowance is counted over 90 days from `ledger_entries.at`.**
  If entries were ever backdated by a repair script that window would move. No
  such script exists and none should.

## Reproducing this

```
pnpm reconcile          # every materialised column against the ledger, nightly
pnpm prove:booking      # parallel clients, one slot
pnpm prove:payout       # parallel clients, one balance
pnpm prove:restore      # dump, restore, check the ledger still cancels
```
