# Tutoring Marketplace — Product & Technical Spec

Working name: **Tutorly** (placeholder — rename anywhere you see it).

One line: a discovery-first tutoring marketplace where verified tutors set their own hourly and half-hour rates, students buy credits and spend them on booked sessions, all calls happen on-platform (video or voice), tutors can offer short free trials, and tutors cash out by bank transfer once their balance reaches $100.

---

## 1. Roles

| Role | Can do |
|---|---|
| Guest | Browse feed, view tutor profiles, watch intro videos, search. Cannot book. |
| Student | Buy credits, book trials and paid sessions, join calls, message tutors, review, follow tutors. |
| Tutor (unverified) | Build profile, upload credentials, set rates and availability. **Not shown in feed, cannot be booked.** |
| Tutor (verified) | Everything above + appears in feed, receives bookings, earns balance, requests payouts. |
| Admin | Verify tutors, approve payouts, handle disputes/refunds, suspend accounts, view dashboards. |

A single account can hold both `student` and `tutor` roles (a tutor can take lessons too). Roles are a set, not a single column.

---

## 2. Money model

### Units

**Everything in integer US cents. Never floats, never `Decimal` in JS.** `1 credit = $1.00 = 100 cents`. The DB column is `credits_cents`.

### Credit packs (configurable in admin)

| Pack | Pays | Gets | Effective |
|---|---|---|---|
| Starter | $10 | 1,000 credits-cents | — |
| Standard | $25 | 2,600 | +4% bonus |
| Plus | $50 | 5,400 | +8% |
| Pro | $100 | 11,000 | +10% |

Credits never expire (simpler, avoids consumer-law problems). Credits are **non-refundable to cash** — refunds are returned as credits. Say this plainly in the Terms.

### Tutor pricing

- Tutor sets a **60-minute rate**. Floor `$5.00`, ceiling `$200.00`.
- **30-minute rate** is auto-derived as `round_to_50c(hourly / 2)`, and the tutor may override it, constrained to `40%–70%` of the hourly rate (stops the "30 min costs the same as 60 min" trick).
- Rate changes never affect already-confirmed bookings. Price is snapshotted onto the booking row at creation time.
- Tutors may run a promo rate with a start/end date; feed shows a struck-through original.

### Take rate

Platform commission default **20%**, stored per-tutor (`commission_bps`, default `2000`) so you can offer 15% to early or high-volume tutors. Tutor receives `80%`.

### Session money lifecycle (escrow)

```
BOOKING CREATED   student.credits_cents  -= price
                  booking.escrow_cents   += price
SESSION ENDS      (nothing yet — dispute window opens, 24h)
WINDOW CLOSES     booking.escrow_cents   -= price
                  tutor.pending_cents    += price * (1 - commission)
                  platform.revenue_cents += price * commission
+ 0h              tutor.pending_cents    -> tutor.available_cents
```

`pending` vs `available` exists so you can add a hold period later (e.g. 3 days for new tutors) without a schema change.

### Cancellation & no-show policy

| Event | Student credits | Tutor |
|---|---|---|
| Student cancels > 24h before | 100% refund | nothing |
| Student cancels 2–24h before | 50% refund | 50% of their share |
| Student cancels < 2h before | 0% refund | 100% of their share |
| Tutor cancels, any time | 100% refund | strike; 3 strikes/90d = review |
| Student no-show (tutor joined, waited 10 min) | 0% refund | 100% of their share |
| Tutor no-show | 100% refund + 1 free-session credit | strike |
| Technical failure, < 50% of duration attended by both | 100% refund | nothing, no strike |

All of these are one function, `resolveBookingOutcome(booking, attendance)`, returning a list of ledger entries. Test it heavily.

### Payouts

- Threshold: `available_cents >= 10000` ($100). Tutor may request any amount at or above the threshold, including their whole balance.
- Tutor supplies payout details once: account title, bank name, country, IBAN or account number, SWIFT/BIC (for international), and for Pakistan-domiciled tutors an optional CNIC. Stored **encrypted at rest** (app-level AES-GCM with a key in the env, not just DB encryption), last-4 shown in UI.
- Statuses: `requested → approved → processing → paid` or `→ rejected(reason)`.
- On request: amount moves `available_cents → payout_locked_cents` immediately so it can't be double-spent.
- Admin marks paid with a reference number; tutor sees it in earnings history.
- Payout fee: configurable flat fee (default `$0`), deducted from the payout amount.
- Cadence: manual admin approval for now. Automate later.

---

## 3. Tutor onboarding

Wizard, resumable, saves a draft at every step:

1. **Account** — email + password or Google. Verify email.
2. **Identity** — full name, country, city, IANA timezone, spoken languages with proficiency.
3. **Profile** — headline (max 80 chars), bio (150–2,000 chars), profile photo.
4. **Intro video** — 30–90 seconds, required. This is what makes the feed feel like YouTube. Upload → transcode to HLS + generate 3 thumbnail candidates → tutor picks one.
5. **Subjects** — up to 5 from a controlled taxonomy, each with a level (beginner / intermediate / advanced / exam-prep) and years of experience.
6. **Credentials** — at least one document. Type: degree, diploma, certificate, teaching licence, or ID. Each is `{file, type, institution, title, year}`. Stored in a **private** bucket; admin views via 60-second signed URLs. Never public.
7. **Rates** — hourly, 30-min, trial on/off + trial length + max trials per week.
8. **Availability** — weekly recurring grid.
9. **Payout details** — can be deferred until first payout request.
10. **Submit for review.**

Profile statuses: `draft → pending_review → verified` | `rejected(reason, editable)` | `suspended`.

An unverified tutor is invisible in search and the feed and cannot be booked. Rejection emails must name the specific reason and allow resubmission.

---

## 4. Discovery — the "YouTube but for tutors" part

This is the heart of the product. Signed-out and signed-in home is a **video-first infinite grid**, not a directory table.

### Tutor card

- 16:9 intro-video thumbnail; on hover (desktop) or on 50%-viewport (mobile), autoplay muted for 8s
- avatar, name, verified check
- 1–3 subject chips
- ★ rating + review count
- `$X/hr` (struck-through original if on promo)
- badges: `Free trial` · `Available today` · `Responds in <1h` · `New`
- micro-line: "Next free: Today 6:30 PM" in the *viewer's* timezone

### Home rails (each horizontally scrollable, above the infinite grid)

- Category chips row: Math, Physics, Chemistry, Biology, English, IELTS/TOEFL, Programming, Quran & Arabic, Business, Music, Test Prep, Languages
- **Continue with your tutors** — tutors you've had a session with, one-tap rebook (this is your "watch history" row)
- **Available in the next hour**
- **Free trials**
- **New tutors** — exploration slot, so new supply isn't starved
- **Top rated in {your last searched subject}**
- then: infinite scroll grid of ranked tutors

### Search & filters

Full-text over name, headline, bio, subjects. Filters: subject, price range, min rating, language, day/time window, has free trial, verified only, country. Sort: relevance, price ↑/↓, rating, most sessions.

### Ranking score

```
score = 0.30 * bayesian_rating
      + 0.20 * completion_rate
      + 0.15 * trial_to_paid_rate
      + 0.15 * availability_density_next_7d
      + 0.10 * response_speed
      + 0.10 * recency_of_activity
      + exploration_boost (new tutors, decays over 30 days / 20 sessions)
```

Bayesian rating: `(C*m + Σratings) / (C + n)` with `m = 4.3`, `C = 5`. Stops a single 5★ review outranking a tutor with 200 reviews.

Recompute nightly into a `tutor_ranking` table. Do not compute in the request path.

### Tutor profile page

Video hero → about → subjects & levels → verified qualifications (institution + year, never the document itself) → reviews with rating breakdown → **booking calendar** → sticky footer CTA on mobile: `Book free trial` / `Book session`.

### Follow

Students follow tutors. When a followed tutor publishes new availability, followers get a notification. Cheap retention loop.

---

## 5. Availability & booking

### Availability

- Weekly recurring rules per tutor: `{weekday, start_time, end_time}` in the **tutor's** timezone, converted to UTC for storage.
- Exceptions: block a date range (vacation mode), or add a one-off extra window.
- Slot granularity: **30 minutes**.
- Configurable per tutor: buffer between sessions (0/5/10/15 min), max sessions per day, booking horizon (default 30 days), minimum lead time (default 60 min).

### Booking flow

1. Student opens tutor page → calendar renders free slots **in the student's timezone**, with the tutor's local time shown underneath.
2. Student picks duration (30 or 60 min) and a start slot. 60-min bookings require two contiguous free slots.
3. Price shown in credits. If balance is short → inline "top up" step that returns to the same slot (hold the slot for 10 minutes with a soft lock).
4. Confirm → credits debited to escrow → status `confirmed` → both parties emailed + calendar `.ics` attached.

### Double-booking prevention

Do not rely on an availability check alone. Enforce at the database:

```sql
-- partial unique index over active bookings
CREATE UNIQUE INDEX booking_no_overlap
  ON bookings (tutor_id, start_at)
  WHERE status IN ('pending_tutor','confirmed','in_progress');
```

plus a `SERIALIZABLE` (or `SELECT ... FOR UPDATE` on the tutor row) transaction wrapping the slot check, the credit debit, and the insert. All three succeed or none do.

### Reschedule

Once per booking, requested more than 12h before start, requires the other party's acceptance within 6h or it expires and the original stands.

### Booking statuses

`pending_tutor` (trials only) → `confirmed` → `in_progress` → `completed` → `settled`

Terminal alternatives: `cancelled_by_student`, `cancelled_by_tutor`, `expired`, `no_show_student`, `no_show_tutor`, `disputed`, `refunded`.

---

## 6. Free trials

- Tutor toggles trials on and picks a length: 10, 15 or 20 minutes. Also sets `max_trials_per_week` (default 5) so trials can't eat their calendar.
- **One free trial per student–tutor pair, lifetime.** Enforced by a unique index on `(student_id, tutor_id)` for rows where `is_trial = true`.
- Trial bookings start as `pending_tutor`. The tutor accepts or declines. Auto-expires after 12 hours or 2 hours before start, whichever comes first.
- Zero credits move. No escrow row. Doesn't count toward tutor earnings or ranking revenue metrics, but **does** count toward `trial_to_paid_rate`.
- Trial slots use the same availability engine but occupy only the trial length, and get a 5-minute buffer after.
- Post-trial screen for the student: "Book a full session with {tutor}" with the next three free slots pre-loaded. This is the conversion moment — make it the loudest thing on the page.
- Abuse guard: max 3 outstanding trial requests per student at once; max 5 trials per student per week across all tutors.

---

## 7. The call

**LiveKit** (Cloud has a usable free tier; self-host later if volume justifies it).

- One room per booking, `room_name = booking_{uuid}`.
- Access tokens minted server-side only, valid `start - 5min` to `end + 10min`, granted only to the two participant user IDs. Never mint a token from client-supplied identity.
- Modes: **video** or **voice-only**; either party can switch mid-call.
- In-call: mute, camera toggle, screen share, device picker, text chat, file drop, connection-quality pill, elapsed/remaining timer, "End session".
- Warning toast at T-5 min and T-1 min. Grace period: room stays open 10 min past the end so a session can run slightly long, but the timer stops billing at the booked duration.
- Server subscribes to LiveKit webhooks (`participant_joined`, `participant_left`, `room_finished`) and writes a `session_events` log. **Attendance and duration come from these events, never from the client.**
- Auto-complete: if both participants were present for ≥ 50% of the booked duration, mark `completed` at scheduled end. Otherwise route to the dispute path.
- Phase 3 extras: collaborative whiteboard, recording with explicit two-party consent, live captions.

---

## 8. Messaging

- One thread per student–tutor pair, created only when a booking or trial request exists. No cold DMs — this alone kills most spam.
- Attachments up to 25 MB (homework, PDFs, images).
- **Contact-info masking:** emails, phone numbers and social handles are redacted in message bodies with a visible "Contact details are hidden — keep payments on-platform" notice. Redact server-side on write, keep the raw text in a moderation-only column.
- Tutor response-time median is tracked and feeds the ranking score and the "Responds in <1h" badge.

---

## 9. Reviews

- Only from a student on a `completed` **paid** session (trials cannot be reviewed).
- 1–5 stars + optional text, editable for 7 days, one review per booking.
- Tutor may post one public reply per review.
- Displayed rating is the Bayesian average; the raw distribution is shown as a breakdown bar.
- Admin can hide a review for policy violation, with a logged reason.

---

## 10. Admin

**Queues:** tutor verification · payout requests · reports & disputes · refund requests · flagged messages.

**Verification screen:** side-by-side of profile claims and the credential documents (signed URLs, watermarked view), approve / reject-with-reason buttons, and a checklist (name matches document, institution plausible, document legible, not expired).

**Dashboard:** GMV, net revenue, take rate, credits sold vs credits consumed (this is your float / liability), outstanding payout liability, active tutors, sessions completed, trial→paid conversion, cancellation rate by side, top subjects.

**Every money-moving admin action writes an `admin_audit` row** with actor, action, target, before/after, reason, IP. No exceptions.

---

## 11. Notifications

Email (Resend) + in-app bell. Each is a template with an opt-out where legally allowed:

booking confirmed · reminder 24h · reminder 1h · "your session starts in 10 minutes, join now" · trial requested (tutor) · trial accepted/declined (student) · session completed + review prompt · credits low · credits purchased · verification approved/rejected · payout requested/approved/paid · new review · followed tutor added new slots · cancellation by either side.

---

## 12. Data model

```
users                id, email, password_hash, roles[], name, avatar_url, timezone,
                     country, email_verified_at, created_at, suspended_at
student_wallets      user_id PK, credits_cents, lifetime_purchased_cents
tutor_profiles       user_id PK, status, headline, bio, intro_video_id,
                     hourly_cents, half_hour_cents, promo_cents, promo_ends_at,
                     commission_bps, offers_trial, trial_minutes, max_trials_per_week,
                     buffer_minutes, max_sessions_per_day, booking_horizon_days,
                     min_lead_minutes, pending_cents, available_cents,
                     payout_locked_cents, lifetime_earned_cents,
                     verified_at, verified_by, rejection_reason, strikes
videos               id, owner_id, hls_url, thumbnail_url, duration_s, status
credentials          id, tutor_id, kind, title, institution, year,
                     file_key (private bucket), status, reviewed_by, reviewed_at, note
subjects             id, slug, name, parent_id
tutor_subjects       tutor_id, subject_id, level, years_experience
availability_rules   id, tutor_id, weekday, start_time_utc, end_time_utc, active
availability_excepts id, tutor_id, date, kind(block|extra), start_utc, end_utc
bookings             id, student_id, tutor_id, subject_id, is_trial,
                     start_at_utc, duration_minutes, status,
                     price_cents (snapshot), commission_bps (snapshot),
                     escrow_cents, student_tz, tutor_tz,
                     livekit_room, created_at, cancelled_at, cancelled_by,
                     reschedule_count, settled_at
session_events       id, booking_id, user_id, event, at_utc, raw jsonb
ledger_entries       id, at, booking_id?, payout_id?, purchase_id?,
                     account (student_credits|escrow|tutor_pending|
                              tutor_available|platform_revenue|payout_locked),
                     owner_id, delta_cents, reason, idempotency_key UNIQUE
credit_purchases     id, user_id, pack_id, paid_cents, credits_cents,
                     provider, provider_ref, status, idempotency_key UNIQUE
payout_methods       id, tutor_id, account_title, bank_name, country,
                     account_number_enc, swift_enc, last4, is_default
payouts              id, tutor_id, method_id, amount_cents, fee_cents, status,
                     requested_at, decided_by, decided_at, paid_ref, reject_reason
reviews              id, booking_id UNIQUE, student_id, tutor_id, rating,
                     body, tutor_reply, hidden_at, created_at
follows              student_id, tutor_id, created_at
threads / messages   id, thread_id, sender_id, body_masked, body_raw, attachments[], read_at
reports              id, reporter_id, target_type, target_id, reason, body, status
admin_audit          id, actor_id, action, target_type, target_id, before, after, reason, ip
tutor_ranking        tutor_id PK, score, computed_at   -- nightly job
```

`ledger_entries` is append-only. **A user's balance is a materialised sum of their ledger, and a nightly job asserts the materialised column equals the ledger sum.** If they ever diverge, alert loudly. This one decision will save you when money goes weird — and it will go weird.

---

## 13. Non-negotiable engineering rules

1. Money is integer cents. No floating point anywhere near a price.
2. All timestamps stored UTC; every user has an IANA timezone; every rendered time is converted client-side. Test with a tutor in `Asia/Karachi` and a student in `America/New_York` across a DST boundary.
3. Every payment webhook and booking mutation carries an idempotency key with a unique index. Webhooks arrive twice.
4. Authorization is checked server-side on every query, by row. Never trust a client-supplied user ID or role.
5. Credential and payout data live in a private bucket / encrypted columns. Signed URLs expire in 60 seconds.
6. Rate limit: auth (5/min/IP), booking creation (10/hr/user), messaging (30/min/user), trial requests (3 outstanding).
7. Every state transition on `bookings` goes through one state machine function. No scattered `status = 'x'` updates.
8. Seed script must produce a realistic world: 40 tutors with varied rates/subjects/availability/ratings, 10 students with credits, past completed sessions, pending verifications, and a payout request sitting at exactly $100.

---

## 14. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict |
| DB | Postgres (Neon or Supabase) |
| ORM | Drizzle + drizzle-kit migrations |
| Auth | Auth.js v5 (email/password + Google) |
| UI | Tailwind + shadcn/ui |
| Video | LiveKit Cloud |
| Storage | Cloudflare R2 (S3 API) — private bucket for credentials, public for videos/avatars |
| Video transcode | Mux or Cloudflare Stream for intro videos |
| Email | Resend + React Email |
| Jobs/cron | Vercel Cron + Upstash QStash |
| Errors | Sentry |
| Tests | Vitest (unit, money & scheduling) + Playwright (booking → call → settle) |
| Hosting | Vercel |

### Payments — read this before you build

Stripe does **not** support businesses domiciled in Pakistan, and this is the single thing most likely to block your launch. Do not hard-code a provider. Build a `PaymentProvider` interface:

```ts
interface PaymentProvider {
  createCheckout(userId: string, packId: string): Promise<{ url: string }>;
  verifyWebhook(req: Request): Promise<PaymentEvent>;
}
```

Ship a `MockProvider` (instantly credits the wallet in dev) so the whole product is buildable today, then plug in whichever of these you qualify for: **Paddle** or **Lemon Squeezy** (merchant-of-record, they handle global tax and can pay you out to a PK bank via wire/Payoneer), **2Checkout/Verifone**, or a US/UAE entity + Stripe. For local students, JazzCash/Easypaisa via a local PSP can be a second provider behind the same interface.

Payouts to tutors are manual bank transfers in v1 (admin approves, you send the wire). Wise Business or Payoneer for international tutors. That's fine at low volume and buys you time.

---

## 15. Build phases

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Repo, schema, migrations, auth, seed data | `pnpm seed` produces the world in §13.8; login works for all 3 roles |
| 1 | Tutor onboarding wizard + admin verification queue | A tutor goes draft → verified and appears in a raw list |
| 2 | Discovery feed, search, filters, tutor profile page | Feed renders 40 seeded tutors with autoplay cards and working filters |
| 3 | Availability engine + booking + credits (MockProvider) | Student buys credits, books a 60-min slot, double-booking is impossible |
| 4 | LiveKit calls + session state machine + escrow settlement | Two browsers complete a call; 24h later the tutor's balance is correct |
| 5 | Trials, messaging, reviews, follows | Free trial requested → accepted → taken → conversion CTA fires |
| 6 | Payouts + admin dashboard + audit log | Tutor at $100 requests, admin pays, ledger reconciles to zero drift |
| 7 | Real payment provider, notification templates, SEO, analytics | First real dollar in, first real payout out |

---

## 16. Acceptance tests

- Two students click the same slot within 50 ms; exactly one booking exists and only one wallet was debited.
- Tutor raises their rate after a booking exists; that booking still charges the old price.
- A student with 400 credits-cents tries to book a $6 session; blocked with an inline top-up, and the slot is held 10 min.
- Karachi tutor, New York student, session crossing a US DST change: both see the correct local time.
- Student cancels 90 minutes before start; 0% refunded, tutor's share credited at settlement.
- Tutor never joins; student is fully refunded and the tutor takes a strike.
- Stripe-equivalent webhook delivered three times; exactly one credit purchase is recorded.
- The same student requests a second free trial with the same tutor; blocked.
- Tutor at $99.50 cannot request a payout; at $100.00 they can.
- Sum of all `ledger_entries` per account equals every materialised balance column.
- A logged-out user hitting `/api/bookings/{id}` for someone else's booking gets 404, not 403 (don't leak existence).
