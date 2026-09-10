# Launch

Everything between an empty database and a marketplace somebody can use. Written
so that a person who is not me could do it, in order, without asking a question.

Time it takes, roughly: **two hours**, most of which is waiting for DNS.

---

## 0. Before you start

You need accounts for:

| What | Why | Free tier enough? |
|---|---|---|
| Postgres 16 (Neon, Supabase, RDS) | Everything | Yes to begin |
| Vercel | The app and the cron schedule | Yes |
| Cloudflare R2 | Credential documents, avatars, intro videos | Yes |
| LiveKit Cloud | The classroom | No — pick a region first, see §3 |
| Resend | Email | Yes to begin |
| A payment provider | Selling credits | n/a |
| A domain | All of the above | No |

**The payment provider is the one open decision.** `DECISIONS_NEEDED.md` item 1
is still open because Stripe does not operate in Pakistan. Until it is answered,
`PAYMENT_PROVIDER=mock` credits wallets instantly and nobody is charged — which
is fine for a closed test with tutors you know, and is not a launch.

### Run these once, on a seeded copy, before you deploy anything

They need the seeded world — a tutor over the payout threshold, a tutor with
free hours — so they belong on a development database rather than in the
production smoke test in §7. They are the two concurrency proofs the money
depends on, and they exit non-zero when they fail.

```
pnpm seed
pnpm prove:booking       # two clients race one slot  → exactly one booking
pnpm prove:payout        # eight clients race one balance → exactly one payout
pnpm prove:curriculum    # the database refuses three impossible curriculum rows
pnpm prove:rates         # a rate change reaches no booking that already exists
pnpm prove:payout-privacy  # a dump of payout_methods yields nothing usable
pnpm reconcile           # seven materialised balances against the ledger
```

`MONEY_AUDIT.md` says what each of them is defending and what was found when
they were written.

---

## 1. Environment variables

Set every one of these in Vercel → Settings → Environment Variables, for
**Production**. `.env.example` is the same list with comments.

### Required — the app will not start without them

```
DATABASE_URL          postgres://…  (with ?sslmode=require on a managed host)
AUTH_SECRET           openssl rand -base64 32
AUTH_URL              https://YOUR-DOMAIN        ← no trailing slash
AUTH_TRUST_HOST       true
PAYOUT_ENCRYPTION_KEY openssl rand -base64 32    ← must decode to exactly 32 bytes
```

`AUTH_URL` is load-bearing beyond auth: every canonical URL, every link in every
email, and every unsubscribe token is built from it. Set it to the real HTTPS
origin. Never infer it from a request header.

**`PAYOUT_ENCRYPTION_KEY` cannot be rotated casually.** Every stored payout
account is encrypted with it; changing it makes those rows unreadable and tutors
have to re-enter their bank details. Put it somewhere you will still have it in
a year.

### Required before anybody teaches

```
LIVEKIT_URL           wss://YOUR-PROJECT.livekit.cloud
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_PUBLIC_BUCKET      avatars and intro videos
R2_PRIVATE_BUCKET     credential documents — must NOT be public
R2_PUBLIC_BASE_URL    https://cdn.YOUR-DOMAIN
CRON_SECRET           openssl rand -base64 32
```

**Without `CRON_SECRET` every scheduled endpoint returns 404.** That is
deliberate — an unconfigured deployment should fail to run its jobs rather than
expose them — but it means settlement, reminders, standing sessions and email
all silently stop. It is the single most common way this deployment breaks.

### Required before anybody gets an email

```
RESEND_API_KEY
EMAIL_FROM            Tutorly <hello@YOUR-DOMAIN>
EMAIL_REPLY_TO        (optional, but people do reply)
```

### Optional

```
AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET   the sign-in button hides itself when unset
PAYMENT_PROVIDER                      "mock" until item 1 is answered
```

---

## 2. DNS

At your registrar, or Cloudflare if the domain is there.

| Record | Name | Value | For |
|---|---|---|---|
| A / CNAME | `@` and `www` | Vercel's target | The app |
| CNAME | `cdn` | your R2 public bucket's domain | Avatars, intro videos |
| TXT | `@` | `v=spf1 include:_spf.resend.com ~all` | SPF |
| CNAME | `resend._domainkey` | given by Resend | DKIM |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@YOUR-DOMAIN` | DMARC |

**Get all three mail records right before sending anything.** A domain that
starts sending without SPF and DKIM lands in spam, and a domain's sending
reputation is much easier to protect than to repair. Start DMARC at `p=none`
(monitor only), read the reports for a fortnight, then move to `p=quarantine`.

Verify before you send a single message:

```bash
dig +short TXT YOUR-DOMAIN | grep spf1
dig +short CNAME resend._domainkey.YOUR-DOMAIN
dig +short TXT _dmarc.YOUR-DOMAIN
```

Resend's dashboard has to show the domain **verified**. Until it does,
`EMAIL_FROM` will be rejected with a 403 and every message will land in dead
letters, where `/admin/alerts` will show it.

---

## 3. LiveKit region

`DECISIONS_NEEDED.md` item 20 is open pending a measurement from the market.

```bash
pnpm measure:regions      # run this from Karachi, not from a datacentre
```

Pick the region with the lowest median. Dubai is the expectation; Mumbai is the
alternative; anything in Europe or North America is a mistake for this market
and will show up as the connection quality that makes people stop using it.

---

## 4. The database, from empty

Order matters. Migrations before seed, seed before an admin.

```bash
# 1. Schema. 25 migrations, applied one transaction per file — a Postgres enum
#    cannot be added and used in the same transaction, which is why the
#    migrator does not use drizzle's default all-in-one behaviour.
pnpm db:migrate

# 2. Confirm.
psql "$DATABASE_URL" -c "select count(*) from drizzle.__drizzle_migrations"
```

**Do not run `pnpm seed` against production.** It truncates every table. It
builds a development world with 66 fake people and it will delete anything you
already have.

Production needs three things seeded instead:

```bash
# a. Credit packs and the platform accounts.
psql "$DATABASE_URL" -f docs/launch/packs.sql

# b. The launch board's curriculum — boards, classes, subjects, chapters.
psql "$DATABASE_URL" -f docs/launch/curriculum.sql

# c. Your admin account (see §5).
```

Both files are generated from the same definitions the code uses, so they cannot
drift from it:

```bash
pnpm launch:sql        # writes docs/launch/*.sql from src/lib
```

It emits 5 credit packs, 10 boards, 46 classes, 12 subjects and 152 chapters,
and every statement is idempotent — running it again after adding a board is
safe. **This whole section has been run against an empty database**: 23
migrations, both files, then both files a second time, then `pnpm reconcile`
(zero entries, zero drift).

---

## 5. The first admin

There is no "make me an admin" button, deliberately: a self-service path to the
role that approves payouts is a self-service path to the money.

```bash
# 1. Sign up through the site as a normal student, with your real email.
# 2. Promote that one account, by hand, once:
psql "$DATABASE_URL" -c \
  "update users set roles = array['student','tutor','admin']::user_role[] where email = 'you@yourdomain.com'"
# 3. Sign out and back in — roles are read from the session token.
```

Check it: `/admin` should load and `/admin/alerts` should say what is wrong,
which on an empty database is nothing.

---

## 6. Providers to swap from mock

| Interface | Mock | Real | Where |
|---|---|---|---|
| `PaymentProvider` | credits instantly | pending item 1 | `src/lib/payments/` |
| `EmailProvider` | records, sends nothing | Resend | `src/lib/email/` |
| `OutboundProvider` | records, sends nothing | a WhatsApp BSP | `src/lib/messaging/out/` |

Email swaps itself the moment `RESEND_API_KEY` and `EMAIL_FROM` are both set.
The other two need a class next to the mock and one line in the factory; nothing
above those files knows which is in use.

**WhatsApp is still a mock and that is a real gap at launch.** The routing,
dedupe and audience rules are all live — the T-1h and T-10min nudges are picked,
keyed and recorded — but nothing leaves the building. Every one of those also
goes to the in-app bell and, where the person has not turned it off, to email.

---

## 7. Smoke test, against production, before anybody else

Run every one of these. They take ten minutes and they are the difference
between finding a problem yourself and hearing about it from a tutor.

```bash
# 1. The app is up and its four dependencies are real.
curl -sS https://YOUR-DOMAIN/api/health
#    → {"ok":true,"checks":{"database":"up","storage":"up","livekit":"up","payments":"up"},"email":"configured"}
#    Anything "down" here is a stop.

# 2. Public pages serve to a stranger.
for p in / /terms /privacy /pricing /teach /robots.txt /sitemap.xml; do
  printf "%-14s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://YOUR-DOMAIN$p)"
done
#    → 200 for all of them.

# 3. Member pages do not.
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-DOMAIN/dashboard   # → 307
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-DOMAIN/admin       # → 307

# 4. Robots is not accidentally disallowing everything. (It does that on
#    purpose anywhere that is not the production origin over HTTPS.)
curl -sS https://YOUR-DOMAIN/robots.txt
#    → "Allow: /" and a Sitemap line. If it says "Disallow: /", AUTH_URL is wrong.

# 5. The crons are reachable and refuse an unsigned caller.
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-DOMAIN/api/cron/email             # → 404
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CRON_SECRET" \
  https://YOUR-DOMAIN/api/cron/email                                                    # → 200

# 6. The money adds up on an empty database, which is the easiest case and
#    still worth proving the connection and the query work.
DATABASE_URL="…" pnpm reconcile          # → zero drift

# 7. The backup is real.
DATABASE_URL="…" pnpm prove:restore      # → "Restore verified"
```

Then, by hand, in a browser:

8. **Sign up** as a student with a real address. **The confirmation email must
   arrive**, and clicking it must turn the amber banner off. If it does not
   arrive, `/admin/alerts` will say why — this is the check that catches an
   unverified sending domain.
8b. **Forget your password on purpose.** Ask for a reset from `/forgot-password`,
    use the link, and confirm three things: the new password signs you in, the
    old one does not, and the link is refused the second time. This is the one
    flow whose failure is silent — somebody just never comes back.
8c. **Try to buy the $100 pack before confirming your address.** It must be
    refused, with the reason, and the $25 pack must not be.
9. **Invite yourself a tutor** at `/admin/invite`, in a private window open the
   link, and complete the wizard. The profile should go live without entering
   the verification queue.
10. **Buy the smallest credit pack.** With a real provider, use a real card and
    then refund yourself. With the mock, confirm the wallet moves and
    `pnpm reconcile` stays clean.
11. **Book a session with yourself** (two browsers, two accounts) and join both
    sides. This is the one that exercises LiveKit, the token, the room and the
    attendance webhook — the four things that cannot be tested from a terminal.
12. **Check the calendar invite** opens in whatever you use.

---

## 8. What to watch in the first week

- `/admin/alerts` daily. It is built for this.
- `/api/health` on an uptime monitor, every five minutes, alerting on non-200.
- The Vercel cron log. A cron that silently stopped is how tutors go unpaid.
- Resend's dashboard: bounce rate and spam complaints. Above 0.1% complaints,
  stop and fix the domain reputation before sending more.
- `pnpm reconcile` — the nightly cron does it, but read the result yourself for
  the first week. It now checks seven balances rather than six: a materialised
  money column outside it was double-counted for nine phases without anybody
  noticing (MONEY_AUDIT.md, Q2).
- The share of accounts that never confirm their address. Verification is a
  nudge, so a high number costs nothing until somebody hits a payout or a
  purchase over $25 — but it is also the first sign that the mail is going to
  spam.

---

## 9. Open before this is really a launch

Straight from `DECISIONS_NEEDED.md`, and none of them are code:

| # | What | Blocks |
|---|---|---|
| 1 | A payment provider that works in Pakistan | Taking money at all |
| 4 | What a free-session credit is worth | The §2 promise is unkept |
| 20 | Which LiveKit region | Call quality in the market |
| — | Legal review of the five policy drafts | They say DRAFT on every page |
| — | A WhatsApp business account | The T-1h and T-10min nudges |
| — | A second opinion on SPEC.md §6 | A trial request the tutor never answered no longer burns the student's one free trial with them. That softens "one per pair, for life"; see FLOW_REVIEW.md S9. |

The legal pages are drafts written by an AI and marked as such at the top of
every one. **Have a qualified person read them before you take a payment from a
stranger**, and fill in the operator identity, the addresses and the retention
schedules that the drafts leave blank on purpose.

---

## 10. What is built and not proven

Not open decisions — things that work here and have never met the real world.
`PROGRESS.md` carries the full list; these are the ones that would change a
launch plan.

- **No real money has ever moved.** Every purchase and every payout in every run
  went through a mock. `MONEY_AUDIT.md` proves our handling of a payment event,
  not our handling of JazzCash.
- **The audio-only downgrade has never run on a real lossy network.** It is
  exercised against Chromium's throttling, which shapes the page, the token
  request and the signalling socket — but not the media transport, which in this
  sandbox is UDP to localhost. The first real proof is two people on Pakistani
  mobile data.
- **Email deliverability is unmeasured.** The outbox, the retries and the dead
  letters are real and tested. Whether Gmail puts the message in the inbox is a
  question about a domain that does not exist yet.
- **Nothing has run under load.** The concurrency proofs are eight clients on
  one machine, not a hundred on a fleet — and the rate limiter is in-process
  memory, which is the wrong shape for more than one instance
  (`DECISIONS_NEEDED.md`).
