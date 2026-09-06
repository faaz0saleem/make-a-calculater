# Runbook

For you, at 2am, on a phone, when something is wrong and you are the only one
awake. Every section says what to look at first, what it means, and what to do —
in that order, and with the commands you can paste.

**Before anything else: open [`/admin/alerts`](/admin/alerts).** It checks
everything below live, and it says which of these headings you want. If it says
nothing needs you, believe it and go back to bed.

---

## The one rule

**Never edit the ledger.** Not to fix a balance, not to "correct" a drift, not
because a number looks wrong. The ledger is the record; the materialised
balances are the summary. If they disagree, the summary is what is wrong, and
the repair is a decision you make awake, with `pnpm reconcile` telling you the
exact rows. Every other system in here can be re-run. That one cannot be undone.

---

## Quick reference

| Question | Command |
|---|---|
| Is the app up? | `curl -sS https://YOUR-DOMAIN/api/health` |
| Which dependency is down? | same, and read `checks` |
| Does the money add up? | `pnpm reconcile` |
| What is stuck? | `/admin/alerts` |
| Did email go out? | `pnpm email` then `/admin/alerts#dead-letters` |
| Settle what is due | `pnpm settle --dry-run` then `pnpm settle` |
| Roll standing sessions | `pnpm series` |
| Send due reminders | `pnpm reminders` |
| Is the backup real? | `pnpm prove:restore` |

Scripts need `DATABASE_URL` and the rest of `.env.local`. On Vercel the same
work runs at `/api/cron/*` with the `CRON_SECRET` bearer token — the scripts are
the same code, so running one by hand is safe while the cron is also running.

---

## a-session-failed

**A student or tutor says the lesson would not start.**

1. `/api/health` → is `livekit` up? If it is down, every session is failing and
   this is not about one booking. LiveKit's own status is the next stop.
2. Find the booking. The correlation id is `booking:<id>` and every log line
   about it carries that, so one search in the log viewer gives the whole story
   in order: creation, escrow, joins, settlement, email.
3. Look at `session_events` for that booking. `participant_joined` rows say who
   actually arrived and when.

**Nobody joined at all.** Nothing settles: the booking sits in `confirmed` and
the credits are still in escrow. Decide with the people involved, then resolve
it as a dispute — `/admin/reports` → the booking → settle or refund. Both write
an `admin_audit` row.

**One person joined and waited.** That is a no-show and settlement handles it
without you (`no_show_student` pays the tutor; `no_show_tutor` refunds the
student, adds a ranking penalty, and after two removes instant booking).

**Both joined and the connection died.** `technical_failure` — the student is
refunded in full *and* the tutor is paid their full share out of platform
revenue, capped at two per student per 90 days. It is the one outcome where the
platform pays for both sides. If somebody is at the cap they are still made
whole; the tutor is not paid from revenue, so tell them why.

---

## settlement-did-not-run

**Alert: "Settlement is behind." Tutors have not been paid.**

Settlement runs hourly at `/api/cron/settle`, 24 hours after a session ends.

1. `pnpm settle --dry-run` — lists what tonight would touch, and moves nothing.
2. If that list looks right: `pnpm settle`.
3. If the cron itself has not been firing, check Vercel → Project → Cron Jobs.
   A missing `CRON_SECRET` makes every scheduled endpoint return 404, which
   looks like the route is broken rather than unconfigured.
4. `pnpm reconcile` afterwards. Always.

Settlement is idempotent: it only picks up bookings past their dispute window
that are not already settled. Running it twice is safe. Running it while the
cron runs is safe.

---

## a-payment-did-not-credit

**"I paid and my credits are not there."**

1. Find the purchase: `/admin` → the money overview, or query
   `credit_purchases` by the student's user id.
2. `status = 'pending'` more than a few minutes after they paid means the
   **webhook never arrived**. The payment provider's dashboard has a redelivery
   button; use it. The webhook is idempotent — three deliveries credit once.
3. `status = 'paid'` and no credits is a different, much worse problem: that
   would be a ledger bug, not a delivery one. Stop, run `pnpm reconcile`, and do
   not hand-credit anybody until you understand it.
4. Never top somebody up by editing `student_wallets`. Credits come from a
   ledger entry or they are not real.

The alerts view counts purchases stuck in `pending` for more than two hours. One
is a person who changed their mind at the checkout; a wall of them is the
webhook.

---

## tutor-says-they-were-not-paid

**Work out which of the three things they mean.**

1. **The session has not settled yet.** Sessions settle 24 hours after they end.
   `/tutor/earnings` shows this as pending. Nothing is wrong.
2. **It settled and is in their available balance.** They have the money; they
   have not requested a payout. Minimum is $100.
3. **They requested a payout and it has not arrived.** `/admin/payouts` shows
   the state. `requested` and `approved` mean *we* have not sent it. `paid` with
   a reference means the bank has it and the delay is the bank's.

The alerts view flags any payout older than 72 hours in a state we control. That
is our fault by definition, and it is somebody else's money.

**Never mark a payout paid before the transfer leaves.** `paid` retires the
locked amount from the ledger — it is the platform saying the money is gone. If
you mark it paid and the transfer then fails, the tutor's balance is wrong and
the only fix is a new adjusting entry with a reason.

---

## ledger-drift

**Alert: "Ledger drift." This is the serious one.**

A materialised balance column disagrees with the sum of its ledger rows.

1. `pnpm reconcile` — it names the account, the owner, and both numbers.
2. **Stop approving payouts** until you understand it. Paying out against a
   balance you do not trust is the one mistake you cannot take back.
3. Find when it started: the correlation ids in the log around the affected
   account. A drift is always a write that skipped `appendLedger`.
4. Fix the *code*, then correct the balance with a ledger entry that says why —
   never with an `update` to the balance column.

Drift is not a rounding problem. Every amount is integer cents and every
movement is double entry, so a non-zero drift means a bug wrote a balance
directly.

---

## email-is-not-sending

**Alert: "Email dead letters" or "Email queue is not draining."**

1. `pnpm email` — drains by hand and prints what happened.
2. **Queued and old** means the drain is not running. Check the
   `/api/cron/email` cron and `CRON_SECRET`. Nothing is lost: the queue is
   durable and everything still in it will go when the drain runs.
3. **Dead letters** are messages that gave up after five attempts.
   `/admin/alerts#dead-letters` shows the error and offers a retry.
   - `resend 422` / `403` — the address is bad or the domain is not verified.
     Fix the domain (see LAUNCH.md, DNS) and retry; the message is fine.
   - `resend 429` — rate limited. Retry; if it keeps happening, the drain's
     batch size is too big for the plan.
   - `render:` — a bug in a template, not a delivery problem. The payload is on
     the row.
4. Nothing configured? With no `RESEND_API_KEY` the app uses the mock transport
   and sends nothing. That is the correct behaviour for a preview deployment and
   a disaster for production, so the health check reports which one you are on.

**A reminder that silently failed is a no-show.** That is why this queue is
visible at all.

---

## standing-sessions-stopped

**Recurring sessions are not appearing, or are not being paid for.**

`pnpm series` does three things: materialises four weeks ahead, warns at T-72h,
charges at T-48h, and lapses what went unpaid. Hourly, at `/api/cron/series`.

- **No new occurrences**: the job has not run, or the tutor's availability no
  longer covers the slot. The series page shows the clash dates.
- **Occurrences stuck in `scheduled` past their start**: the job has not run.
  It sweeps those to `lapsed` on the next run rather than leaving them.
- **A student says their session vanished**: look for `lapsed`. It means they
  did not have credits at T-48h. They were warned at T-72h — the email and the
  bell both say so, and `email_deliveries` proves whether it went.

---

## refunds-look-wrong

**Alert: "Refunds are high."**

More than 20% of the last day's money went back as refunds. Usually one of:

- A tutor cancelling repeatedly (`/admin` → cancellation by side).
- A run of technical failures — check `livekit` in `/api/health` first.
- One large refund, which is fine and just moves the ratio.

Query `ledger_entries` for `reason like '%:refund'` in the window and look at
the bookings behind them. The tier is decided by `resolveBookingOutcome` and is
the same code that showed the student their refund before they confirmed, so a
"wrong" refund is a policy question, not a bug.

---

## somebody-needs-their-data-deleted

1. Deleting a `users` row cascades to their profile, bookings, messages,
   notifications, email deliveries and preferences.
2. It does **not** cascade to `ledger_entries`, and it must not: those are the
   financial record and their `owner_id` is nullable for exactly this reason.
   The money history survives as anonymous rows.
3. Do not delete a user with an unsettled booking or an unpaid payout. Settle
   first, then delete.

---

## restoring-from-backup

**Prove it before you need it:** `pnpm prove:restore` dumps the live database,
restores it into a scratch one, checks every critical table's row count survived
and that the ledger still balances, then drops the scratch copy. It takes a
second on a small database. Run it after any migration you are unsure about.

**Taking a backup by hand:**

```bash
pg_dump --format=custom --no-owner --no-privileges --file=tutorly-$(date +%F).dump "$DATABASE_URL"
```

**Restoring, for real:**

```bash
# 1. Stop the crons first, or a half-restored database will be settled against.
#    On Vercel: unset CRON_SECRET, redeploy. The endpoints then 404.
# 2. Restore into a NEW database, never over the live one.
createdb tutorly_restored
pg_restore --no-owner --no-privileges --dbname="postgres://.../tutorly_restored" tutorly-2026-09-06.dump

# 3. Check it before you point anything at it.
psql "postgres://.../tutorly_restored" -c "select count(*) from ledger_entries"
DATABASE_URL="postgres://.../tutorly_restored" pnpm reconcile

# 4. Only then repoint DATABASE_URL, redeploy, and restore CRON_SECRET.
```

Managed Postgres (Neon, Supabase, RDS) has point-in-time restore, which is
better than any dump — it can bring you back to the minute before the mistake.
Know which you have **before** you need it, and write the answer here:

> Provider: _____________  Retention: _____ days  PITR: yes / no

---

## when-you-do-not-know

1. `/api/health` — is anything actually down?
2. `pnpm reconcile` — is the money right?
3. `/admin/alerts` — is anything stuck?

If all three are clean, whatever is wrong is not costing anybody money right
now, and it can wait until morning. That is the whole point of having those
three checks.
