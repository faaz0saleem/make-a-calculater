/**
 * Contact-info masking (SPEC.md §8).
 *
 * Two people who meet on Tutorly have an obvious incentive to move the money
 * off it, and the first step is always the same: swap an email, a WhatsApp
 * number, an Instagram handle. So bodies are redacted **on write**, and what is
 * stored as the readable body already has the contact details gone. The raw
 * text is kept in a moderation-only column that no student or tutor query
 * touches — see `src/db/messages.ts`, where the readable projection is the only
 * one exported.
 *
 * This is pure and deliberately conservative in one direction: it would rather
 * redact a harmless string of digits than let a phone number through. What it
 * cannot catch is a number spelled out in words, or a handle described rather
 * than written ("my name on Instagram is my first name and my year of birth").
 * Nothing pattern-based catches those; the moderation column exists so a human
 * can.
 */

export type RedactionKind = 'email' | 'phone' | 'handle' | 'link';

export type MaskResult = {
  /** What everyone sees. */
  masked: string;
  /** How many pieces of contact information were taken out. */
  redactions: number;
  /** Which kinds, so moderation can sort by severity later. */
  kinds: RedactionKind[];
};

/** What a redaction is replaced with. Visible, so nobody thinks it was a typo. */
export const REDACTED = '[hidden]';

/** The notice shown alongside a message that had something taken out. */
export const MASKING_NOTICE =
  'Contact details are hidden — keep payments on-platform. Sessions booked outside Tutorly are not covered if anything goes wrong.';

/**
 * Order matters: emails are matched before handles, so `name@gmail.com` is one
 * email rather than an `@gmail` handle inside a word.
 */
const PATTERNS: { kind: RedactionKind; pattern: RegExp }[] = [
  {
    kind: 'email',
    // Deliberately loose about the domain: `name (at) gmail dot com` is handled
    // separately below, and anything with an @ and a dot after it is a lead.
    pattern: /[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  },
  {
    kind: 'email',
    // The spelled-out dodge, which is common enough to be worth one pattern.
    pattern: /[A-Z0-9._%+-]+\s*(?:\(at\)|\[at\]|\sat\s)\s*[A-Z0-9.-]+\s*(?:\(dot\)|\[dot\]|\sdot\s)\s*[A-Z]{2,}/gi,
  },
  {
    kind: 'link',
    // Messaging-app links are a handle wearing a URL. Ordinary links (a past
    // paper, a Wikipedia article) are left alone — this is a marketplace for
    // teaching, and blanket link-stripping would break the teaching.
    pattern:
      /(?<![\w./])(?:https?:\/\/)?(?:www\.)?(?:wa\.me|t\.me|telegram\.me|m\.me|join\.skype\.com|discord\.gg|ig\.me|signal\.me)\/\S+/gi,
  },
  {
    kind: 'handle',
    // "whatsapp 0300 1234567", "my telegram: @someone", "skype: live:name".
    pattern:
      /\b(?:whats\s?app|whatsapp|telegram|signal|skype|insta(?:gram)?|snap(?:chat)?|discord|viber|imo|messenger|wechat|line)\b[\s:–-]*(?:is|me|at|on)?[\s:–-]*[@+]?[A-Z0-9._:+-]{3,}/gi,
  },
  {
    kind: 'phone',
    // Seven or more digits, however they are spaced or punctuated. Seven is the
    // shortest real subscriber number; it also means a long ID pasted into a
    // message gets hidden, which is the safe direction to be wrong in.
    pattern: /(?:\+|\b00)?\(?\d(?:[\d\s().-]{5,}\d)/g,
  },
  {
    kind: 'handle',
    // A bare @handle left over once emails have been taken out.
    pattern: /(?<![A-Z0-9._%+-])@[A-Z0-9._]{3,}/gi,
  },
];

/** Digits in a candidate, so "1 or 2" is not mistaken for a phone number. */
function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/**
 * Mask a message body.
 *
 * Runs each pattern over the text in turn, replacing as it goes, so a later
 * pattern cannot match inside something an earlier one already hid.
 */
export function maskContactInfo(body: string): MaskResult {
  const kinds = new Set<RedactionKind>();
  let redactions = 0;
  let text = body;

  for (const { kind, pattern } of PATTERNS) {
    text = text.replace(new RegExp(pattern.source, pattern.flags), (match) => {
      // Never re-redact a placeholder a previous pass left behind.
      if (match.includes(REDACTED)) return match;

      // A run of digits is only a phone number if there are enough of them.
      if (kind === 'phone' && digitCount(match) < 7) return match;

      redactions += 1;
      kinds.add(kind);
      return REDACTED;
    });
  }

  return { masked: text.replace(/\s{3,}/g, '  ').trim(), redactions, kinds: [...kinds] };
}

/** Whether a body needs the notice shown with it. */
export function wasRedacted(result: Pick<MaskResult, 'redactions'>): boolean {
  return result.redactions > 0;
}
