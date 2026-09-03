# Progress

Phases follow `SPEC.md` §15.

| Phase | Status |
|---|---|
| 0 — repo, schema, migrations, auth, seed | **Done** |
| 1 — tutor onboarding wizard + admin verification queue | **Done** |
| 2 — discovery feed, search, filters, tutor profile | Partly started (see below) |
| 3 — availability engine + booking + credits | Not started |
| 4 — LiveKit calls + session state machine + settlement | Not started |
| 5 — trials, messaging, reviews, follows | Not started |
| 6 — payouts + admin dashboard + audit log | Not started |
| 7 — real payment provider, notifications, SEO, analytics | Not started |

---

## Phase 1 — done

### The onboarding wizard

Ten steps at `/tutor/onboarding`, matching `SPEC.md` §3. Every step is its own
page with a server action behind it, so each submit is a draft save and closing
the tab loses nothing.

There is no `current_step` column. Which steps are finished is derived from the
profile itself (`wizardProgress` in `src/lib/tutors/wizard.ts`), so the wizard
cannot get stuck pointing at a step that is already done, and an admin editing a
row does not desynchronise anything. `/tutor/onboarding` redirects to the first
unfinished step.

Rules enforced server-side, not just in the browser: headline ≤ 80 characters,
bio 150–2,000, at most 5 subjects, at least one credential, hourly rate
$5–$200, 30-minute rate inside the 40–70% band, at least one availability rule.
Payout details are the only optional step.

`tutor_profiles.status` moves through one function, `transitionTutor` — the same
discipline as the booking state machine. `submitForReview` re-runs the whole
completeness check on the server before it will move a profile into the queue.

### Files and the private bucket

Two buckets behind one interface (`src/lib/storage/`): R2 over the S3 API when
it is configured, the local filesystem otherwise. Credentials go to `private`,
avatars and intro videos to `public`.

Private objects are served by `/api/files/[...key]`, which requires **both**:

1. a valid HMAC signature over the key, no more than 60 seconds old — anything
   else is **403**
2. an admin session, or the tutor the document belongs to — anything else is
   **404**, so the endpoint cannot be used to discover a document exists

Uploads are checked for size, declared type, and — for PDF, JPEG and PNG — the
magic bytes, because the browser's `Content-Type` is a claim rather than a fact.
Object keys are validated before they reach any store, so a key cannot walk out
of its bucket.

### The admin verification queue

`/admin/verification` lists what is waiting, oldest first.
`/admin/verification/[tutorId]` puts the profile claims beside the documents,
with the four-item legibility checklist from `SPEC.md` §10 under them.

Approving requires every box ticked; rejecting requires a reason of at least ten
characters, which is shown to the tutor verbatim and can be fixed and
resubmitted. Both decisions write an `admin_audit` row — actor, action, target,
before, after, reason, IP — **inside the same transaction** as the status
change, so a decision cannot exist without a record of who made it.

### Visibility

"An unverified tutor is invisible in search and the feed and cannot be booked"
is one rule, in one place: `src/lib/tutors/visibility.ts`, applied by
`findVisibleTutors` in `src/db/tutors.ts`. An unverified tutor's public profile
404s for everyone except that tutor (previewing their own) and admins.

The home page now has search over name, headline, bio and subject names.

### Verified end to end

`pnpm e2e` reseeds and drives the real UI with Playwright. Six specs:

1. A draft tutor does not appear in the feed or in search.
2. They can preview their own profile; a student and a signed-out visitor both
   get **404**, not 403.
3. They walk all ten steps, uploading a photo, a video and a PDF. Leaving
   mid-wizard and returning to `/tutor/onboarding` resumes at the right step.
4. An admin opens the review screen, the document link is signed and short-lived,
   **stripping the signature returns 403**, approving without the checklist is
   refused, and approving with it verifies the tutor.
5. The tutor now appears in the feed, in search by name and by subject, and
   their profile is publicly reachable.
6. A rejected tutor is shown the reason and can resubmit.

The audit row from that run:

```
action      | tutor.verify
actor       | admin@tutorly.test
before      | {"status": "pending_review"}
after       | {"status": "verified", "checklist": {"notExpired": true, "documentLegible": true,
               "nameMatchesDocument": true, "institutionPlausible": true}}
ip          | 127.0.0.1
```

### Schema change

One table added: `tutor_languages` (tutor, ISO 639-1 code, proficiency).
`SPEC.md` §3 step 2 asks for spoken languages and §4 lists language as a search
filter, so a joinable table beats a jsonb column. Migration `0001`.

---

## What is stubbed

Nothing is a `TODO` standing in for logic. These are pieces later phases own:

| Piece | State |
|---|---|
| Intro video | Uploaded, validated and stored, and the row is marked ready. No transcoding, no HLS ladder, no thumbnail candidates, and duration is unknown — so the 30–90 second rule is only enforced once a duration exists. Phase 2. |
| Home feed | A grid with working search, ordered by the ranking table. No autoplay, no rails, no filters beyond the text query. Phase 2. |
| Tutor profile page | Claims, qualifications and published hours. No video hero, no review breakdown, no booking calendar. Phases 2 and 3. |
| Booking | The `Book session` button is disabled. `assertBookable` in `src/lib/tutors/visibility.ts` is the gate the Phase 3 booking mutation will call. |
| `tutor_ranking` | Seeded with the Bayesian rating only. The weighted score from `SPEC.md` §4 is Phase 2. |
| Rejection emails | The reason is stored and shown in the UI. Sending it is Phase 7, with Resend. |
| Email verification | `users.email_verified_at` exists and the seed fills it in; nothing sends a verification email or blocks on it. See `DECISIONS_NEEDED.md` item 6. |
| `PaymentProvider` | Not written yet. Phase 3 checkout. |
| LiveKit, messaging, notifications | Schema only. Phases 4, 5 and 7. |
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
pnpm e2e                       # reseeds, then drives the UI
```

To walk Phase 1 by hand:

1. Sign in as `newtutor@tutorly.test` (password `tutorly-dev-2026`) and go to
   `/tutor`. The profile is an empty draft.
2. Work through `/tutor/onboarding`. Leave halfway and come back — it resumes.
3. Submit for review.
4. Sign in as `admin@tutorly.test`, open `/admin/verification`, review the
   documents and approve.
5. Sign out and search for them on the home page. Before approval they were not
   there, and their profile 404'd.

### Last full run

```
pnpm typecheck   clean
pnpm test        19 files, 248 tests passed
pnpm build       compiled, 17 routes
pnpm seed        58 users · 40 verified · 5 pending · 1 draft · 1 rejected
                 73 credential PDFs and 46 avatars written to the object store
                 1,399 ledger entries · zero drift
pnpm e2e         6 passed
pnpm reconcile   Ledger reconciled: 1399 entries, zero drift.
```
