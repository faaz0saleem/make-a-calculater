/**
 * When to drop video and keep the call (SPEC.md §7).
 *
 * On a Karachi or Gulf mobile link the useful failure mode is not "the call
 * ends", it is "the call gets worse". A lesson survives losing video; it does
 * not survive losing audio. So when the connection turns poor while the camera
 * is on, the camera goes off — automatically, and with a sentence saying why,
 * because a picture disappearing on its own is otherwise indistinguishable from
 * a bug.
 *
 * Pure, and separate from the classroom component, so the rule can be read and
 * tested without a browser or a peer connection.
 */

/** LiveKit's `ConnectionQuality`, as the four values that matter here. */
export type LinkQuality = 'excellent' | 'good' | 'poor' | 'unknown';

export type DegradeInput = {
  quality: LinkQuality;
  /** True once the call is up. Nothing is decided while connecting. */
  live: boolean;
  /** The session was joined with the camera off to begin with. */
  audioOnly: boolean;
  /** We have already turned the camera off for them once. */
  alreadyDowngraded: boolean;
};

/**
 * Whether to turn the camera off now.
 *
 * Only once: if someone turns their camera back on after a downgrade, that is
 * their choice and the rule does not keep overruling it.
 */
export function shouldDropVideo(input: DegradeInput): boolean {
  if (!input.live) return false;
  if (input.audioOnly || input.alreadyDowngraded) return false;
  return input.quality === 'poor';
}

export const DOWNGRADE_NOTICE =
  'Your connection dropped, so we turned your camera off to keep the audio clear. ' +
  'You can turn it back on when things improve.';

/** What the connection pill says. */
export function qualityLabel(quality: LinkQuality, reconnecting: boolean): string {
  if (reconnecting) return 'Reconnecting';
  switch (quality) {
    case 'excellent':
      return 'Strong';
    case 'good':
      return 'Good';
    case 'poor':
      return 'Weak';
    case 'unknown':
      return 'Checking';
  }
}
