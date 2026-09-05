/**
 * How likely is it that this message is trying to move the relationship off
 * Tutorly? (SPEC.md §8.)
 *
 * Three things this file deliberately is not:
 *
 *  1. **It is not a blocker.** Nothing here stops a message being sent, ever. A
 *     maths tutor typing "question 15 on page 240" or "x = 03" mid-lesson must
 *     never hit a wall, and neither must anyone else — a wrong guess here costs
 *     a real lesson, and the lesson is the product.
 *  2. **It is not a yes or a no.** It returns a score and the reasons behind
 *     it. `high` means a person should look, not that anything happens.
 *  3. **It is not the enforcement.** Nothing calls a sanction from this module.
 *     The ladder in `lib/moderation/sanctions.ts` advances only when an admin
 *     confirms a flag by hand.
 *
 * The masking in `./masking.ts` still runs regardless and is a separate thing:
 * masking hides a number that got typed, this estimates whether somebody meant
 * to. A message can be masked with a score of zero — that is a tutor pasting a
 * long ISBN — and can score high with nothing masked at all, which is somebody
 * saying "call me, you know where".
 *
 * Every signal carries the reason it fired so the moderation queue can show a
 * human *why* something was flagged rather than a bare number.
 */

export type IntentBand = 'none' | 'low' | 'medium' | 'high';

export type IntentSignal = {
  id: string;
  weight: number;
  /** Shown to the admin reviewing the flag. Plain English, not a regex. */
  note: string;
};

export type ContactIntent = {
  /** 0 to 100. Not a probability — an ordering. */
  score: number;
  band: IntentBand;
  signals: IntentSignal[];
  /** What the composer shows before sending, or null for "say nothing". */
  hint: string | null;
};

/** At or above this, a human looks. Below it, nothing leaves the composer. */
export const QUEUE_THRESHOLD = 75;

const BANDS: { at: number; band: IntentBand }[] = [
  { at: QUEUE_THRESHOLD, band: 'high' },
  { at: 50, band: 'medium' },
  { at: 25, band: 'low' },
];

/** Places people move a conversation to. */
const PLATFORMS =
  /\b(whats\s?app|wa|telegram|signal|skype|viber|imo|wechat|snap(?:chat)?|insta(?:gram)?|messenger|discord|line|zoom|meet|gmail|hotmail|yahoo|outlook|proton(?:mail)?)\b/gi;

/** Links that are a handle wearing a URL. */
const MESSAGING_LINK =
  /(?:https?:\/\/)?(?:www\.)?(?:wa\.me|t\.me|telegram\.me|m\.me|join\.skype\.com|discord\.gg|ig\.me|signal\.me)\/\S+/gi;

const EMAIL = /[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** The spelled-out dodge. Somebody writing this is not being careless. */
const OBFUSCATED_EMAIL = /\(at\)|\[at\]|\(dot\)|\[dot\]|\sdot\s?com\b/gi;

const HANDLE = /(?<![A-Z0-9._%+-])@[A-Z0-9._]{3,}/gi;

/** "add me on", "my number is", "text me", and the rest of the family. */
const SOLICITATION =
  /\b(?:add me|text me|call me(?! back to)|dm me|message me (?:on|at)|reach me (?:on|at)|contact me (?:on|at)|my (?:number|cell|mobile|email|e-?mail)|here'?s my|save my number|send me your (?:number|email)|give me your (?:number|email)|what'?s your (?:number|whats\s?app))\b/gi;

/**
 * Moving the *money* off Tutorly. The single strongest thing in this file.
 *
 * Nobody types "cheaper if we do it directly" by accident while teaching, and
 * it is the sentence the whole masking layer exists to catch — so on its own it
 * is enough for a human to look. A phone number is not: a parent asking for a
 * number to call about scheduling is an ordinary thing to want.
 */
const PAYMENT_EVASION =
  /\b(?:pay(?: me)? direct(?:ly)?|no commission|cash in hand|cheaper (?:if|when|outside|direct|without)|skip the (?:app|platform|fee|commission)|without the (?:app|platform|fee))\b/gi;

/** Leaving, without saying anything about money. Weaker, and sometimes innocent. */
const OFF_PLATFORM =
  /\b(?:off(?:[- ])platform|outside (?:the |this )?(?:app|platform|site)|directly with me|move (?:this|it) (?:to|off))\b/gi;

/**
 * Words that mean a nearby number is schoolwork.
 *
 * This list is why the module exists. "Question 15 on page 240" is the single
 * most common sentence on a tutoring platform and must score zero.
 */
const ACADEMIC =
  /\b(?:question|page|exercise|problem|chapter|section|part|unit|paper|topic|example|figure|diagram|table|line|step|slide|mark|grade|class|year|answer|equation|formula|theorem|verse|para|paragraph|volume|edition|sum|isbn|homework|worksheet)s?\b|\b(?:q|qs|qn|qns|pg|pp|ch|sec|eg|fig|ex|eq|no|do|solve|try|attempt|read|skip)\b/i;

/** Algebra. `x = 03` is a value of x, not the start of a mobile number. */
const EQUATION = /[a-z]\s*[=<>]\s*-?$|[+\-*/^×÷]\s*$/i;

const MONEY = /(?:[$£€₹]|\brs\.?|\bpkr\b|\busd\b)\s*$/i;

/**
 * Digit runs long enough to be a subscriber number.
 *
 * Nine, not seven. Seven catches an exercise list ("do 1 2 3 4 5 6 7") and the
 * masking layer already errs on the safe side for those; this layer is deciding
 * whether to trouble a human, and troubling one over a list of question numbers
 * is how a moderation queue becomes something nobody reads.
 */
const DIGIT_RUN = /(?:\+|\b00)?[\d][\d\s().-]{7,}[\d]/g;

function digitsIn(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/**
 * Is this run of digits about schoolwork?
 *
 * Judged on **adjacency**, not on the message as a whole. The word that decides
 * what a number means is the one next to it: "page 240" is a page and
 * "whatsapp me on 0300 1234567" is a phone number, and a message containing
 * both has one of each. An earlier version of this looked at a thirty-character
 * window and let a "question 15" three clauses away excuse a real number.
 */
function isSchoolwork(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 14);

  // The two words immediately before, and the one immediately after.
  const nearBefore = /(?:[A-Za-z.]+[^A-Za-z0-9_]+){1,2}$/.exec(before)?.[0] ?? '';
  const nearAfter = /^[^A-Za-z0-9_]*[A-Za-z]+/.exec(after)?.[0] ?? '';

  if (ACADEMIC.test(nearBefore) || ACADEMIC.test(nearAfter)) return true;

  // Equations and prices are decided by what comes *straight* before the first
  // digit — never by the digits themselves, or a number written `0300-1234567`
  // would read as a subtraction.
  return EQUATION.test(before) || MONEY.test(before);
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/**
 * Phone-shaped numbers that are not obviously about schoolwork.
 *
 * Each candidate is judged in its own neighbourhood rather than the message as
 * a whole, so "question 15 on page 240 — and my number is 03001234567" still
 * flags the number without the question dampening it.
 */
function phoneCandidates(text: string): { value: string; dampened: boolean }[] {
  const out: { value: string; dampened: boolean }[] = [];

  for (const match of text.matchAll(DIGIT_RUN)) {
    const value = match[0];
    if (digitsIn(value) < 9) continue;

    out.push({ value, dampened: isSchoolwork(text, match.index, value.length) });
  }

  return out;
}

function bandFor(score: number): IntentBand {
  return BANDS.find((entry) => score >= entry.at)?.band ?? 'none';
}

/**
 * What the composer says before the message is sent.
 *
 * Written as a reminder of what the platform is for, not as a threat. Somebody
 * who has read it and sends anyway has made a choice, which is exactly the
 * thing a human reviewer needs to know.
 */
function hintFor(band: IntentBand): string | null {
  switch (band) {
    case 'high':
    case 'medium':
      return 'Phone numbers, emails and handles are hidden in messages. Lessons booked off Tutorly are not covered if a session goes wrong, a payment does not arrive, or you need to dispute one.';
    case 'low':
      return 'Contact details are hidden in messages. Everything you need to teach — video, files, rescheduling — is here.';
    default:
      return null;
  }
}

/**
 * Score one message body.
 *
 * Pure: no database, no clock, no side effects. Everything that acts on the
 * result does so somewhere else.
 */
export function scoreContactIntent(text: string): ContactIntent {
  const signals: IntentSignal[] = [];
  const body = text ?? '';

  const add = (id: string, weight: number, note: string) => {
    signals.push({ id, weight, note });
  };

  const links = countMatches(body, MESSAGING_LINK);
  if (links > 0) add('messaging_link', 45, 'A link straight into a messaging app.');

  const emails = countMatches(body, EMAIL);
  if (emails > 0) add('email', 45, 'An email address.');

  const obfuscated = countMatches(body, OBFUSCATED_EMAIL);
  if (obfuscated > 0) {
    // Somebody writing "gmail dot com" knows there is a filter. Weighted at
    // least as heavily as a plain address, because it carries intent as well.
    add('obfuscated_email', 45, 'An address written to get past a filter — "(at)", "dot com".');
  }

  const evasion = countMatches(body, PAYMENT_EVASION);
  if (evasion > 0) {
    add(
      'payment_evasion',
      QUEUE_THRESHOLD,
      'Proposes paying outside Tutorly. On its own, enough for a person to read this.',
    );
  }

  const offPlatform = countMatches(body, OFF_PLATFORM);
  if (offPlatform > 0) {
    add('off_platform', 40, 'Talks about continuing somewhere other than Tutorly.');
  }

  const solicits = countMatches(body, SOLICITATION);
  if (solicits > 0) add('solicitation', 30, 'Asks for, or offers, a way to be reached.');

  const platforms = countMatches(body, PLATFORMS);
  if (platforms > 0) add('platform_named', 30, 'Names a messaging app or a mail provider.');

  const candidates = phoneCandidates(body);
  const live = candidates.filter((candidate) => !candidate.dampened);
  const dampened = candidates.length - live.length;

  if (live.length > 0) add('phone_shaped', 35, 'A run of digits the length of a phone number.');
  if (dampened > 0) {
    add(
      'academic_numbers',
      0,
      `${dampened} number${dampened === 1 ? '' : 's'} left alone — question, page, equation or time.`,
    );
  }

  const handles = countMatches(body, HANDLE) - emails;
  if (handles > 0) add('handle', 20, 'An @handle.');

  // A named app next to a real number is not two weak hints, it is one strong
  // one: "whatsapp 0300 1234567" is unambiguous in a way neither half is.
  if (platforms > 0 && live.length > 0) {
    add('platform_and_number', 20, 'A messaging app named beside a phone-shaped number.');
  }

  const score = Math.max(0, Math.min(100, signals.reduce((total, signal) => total + signal.weight, 0)));
  const band = bandFor(score);

  return { score, band, signals, hint: hintFor(band) };
}

/** True when a human should see this one. Nothing else follows from it. */
export function shouldQueueForReview(intent: ContactIntent): boolean {
  return intent.score >= QUEUE_THRESHOLD;
}
