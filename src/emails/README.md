# Props-only email components

All 14 notification groups in `SPEC.md` §11 are represented below. Each default
export is a React component accepted by React Email's renderer or Resend's
`react` input. Each exposes typed `.plainText(props)` and `.subject(props)`
methods; its file exports named `plainText` and `subject` functions too.

The shared layout uses ordinary email-safe React HTML, inline pixel styles and
presentation tables. The root package does not yet contain React Email or
Resend, and changing its dependencies is outside this branch. There are no
network calls, application-core imports, environment reads or sending actions.

```tsx
import { BookingConfirmed } from '@/emails';
const message = {
  subject: BookingConfirmed.subject(props),
  react: <BookingConfirmed {...props} />,
  text: BookingConfirmed.plainText(props),
};
// Pass message to the configured sender in the core-owned delivery adapter.
```

| SPEC §11 group | Component | Variants / audience |
|---|---|---|
| Booking confirmed | `BookingConfirmed` | student/tutor; paid/accepted trial |
| Reminder 24h | `Reminder24h` | either participant |
| Reminder 1h | `Reminder1h` | either participant |
| Starts in 10 minutes | `SessionStarting` | preparation; call entry opens at T−5 min |
| Trial requested | `TrialRequested` | tutor; actual expiry supplied |
| Trial accepted/declined | `TrialDecision` | student; declined requires reason |
| Completed + review prompt | `SessionCompleted` | student; completed paid sessions only |
| Credits low | `CreditsLow` | student; actual balance supplied |
| Credits purchased | `CreditsPurchased` | purchaser; committed wallet values |
| Verification approved/rejected | `VerificationDecision` | tutor; rejection reason and resubmit URL |
| Payout requested/approved/paid | `PayoutStatus` | tutor; paid requires transfer reference |
| New review | `NewReview` | tutor; no child name required |
| Followed tutor added slots | `FollowedTutorSlots` | follower; live calendar |
| Cancellation by either side | `BookingCancelled` | either participant; resolved amounts |

## Delivery owner responsibilities

- Send from committed, authorised events and deduplicate by event and recipient.
  Never confirm a purchase before crediting the wallet or a payout before a
  transfer is recorded. Cancel obsolete reminders.
- Supply the recipient’s current IANA timezone and absolute ISO instants with an
  offset. No template infers time from the rendering server.
- Supply working absolute HTTP(S) links for actions, support and privacy.
- Optional messages (reminders, low balance, review prompts, new reviews and
  followed-tutor slots) require preferences and unsubscribe URLs. Honour consent
  and stored preferences before sending and set appropriate unsubscribe headers.
- Necessary transaction notices do not offer a global opt-out that would prevent
  delivery of booking, payment or account decisions.
- Keep full bank details, credential documents, private moderation text and child
  identifiers out of props. Payouts accept only four account-ending characters.
- Compute money outcomes in the core. Templates format integer cents and display
  supplied refunds, never calculate commission or cancellation tiers.
- Set `calendarAttached` only if an actual `.ics` is attached. Generate that file
  in the sender with the booking UID and correct UTC/timezone semantics.
- Follow guardian communication and authorisation rules. Collecting a guardian’s
  email does not itself prove legally valid consent.

The 10-minute notice opens preparation; it does not claim call access ten minutes
early, because the existing room gate opens five minutes early.
