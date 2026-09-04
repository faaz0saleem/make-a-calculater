/**
 * When a session can be joined, and how long it counts for (SPEC.md §7).
 *
 * Pure. Every instant here derives from the booking's scheduled start, which is
 * server truth — never from a client clock, and never from when someone
 * happened to press join.
 */

export const JOIN_OPENS_MINUTES_BEFORE = 5;
/** The room stays open past the end so a session can run slightly long. */
export const GRACE_MINUTES_AFTER = 10;
/** Toasts at these many minutes remaining. */
export const WARNING_MINUTES = [5, 1] as const;
/** How long after the session ends before money moves (SPEC.md §2). */
export const DISPUTE_WINDOW_HOURS = 24;

const MINUTE_MS = 60_000;

export type SessionWindow = {
  /** Scheduled start. The clock a student sees counts from here. */
  startUtc: Date;
  /** Scheduled end. Billing stops here however long the room stays open. */
  endUtc: Date;
  /** Earliest anyone may connect. */
  joinOpensUtc: Date;
  /** Latest the room accepts anyone. */
  joinClosesUtc: Date;
  /** When the settlement job may act. */
  settlesAfterUtc: Date;
};

export function sessionWindow(startAtUtc: Date, durationMinutes: number): SessionWindow {
  const startUtc = new Date(startAtUtc);
  const endUtc = new Date(startUtc.getTime() + durationMinutes * MINUTE_MS);

  return {
    startUtc,
    endUtc,
    joinOpensUtc: new Date(startUtc.getTime() - JOIN_OPENS_MINUTES_BEFORE * MINUTE_MS),
    joinClosesUtc: new Date(endUtc.getTime() + GRACE_MINUTES_AFTER * MINUTE_MS),
    settlesAfterUtc: new Date(endUtc.getTime() + DISPUTE_WINDOW_HOURS * 60 * MINUTE_MS),
  };
}

export type JoinState =
  | { canJoin: true; phase: 'early' | 'live' | 'grace' }
  | { canJoin: false; phase: 'too_early' | 'over'; opensInSeconds?: number };

export function joinState(window: SessionWindow, now: Date): JoinState {
  if (now < window.joinOpensUtc) {
    return {
      canJoin: false,
      phase: 'too_early',
      opensInSeconds: Math.ceil((window.joinOpensUtc.getTime() - now.getTime()) / 1_000),
    };
  }
  if (now > window.joinClosesUtc) return { canJoin: false, phase: 'over' };
  if (now < window.startUtc) return { canJoin: true, phase: 'early' };
  if (now <= window.endUtc) return { canJoin: true, phase: 'live' };
  return { canJoin: true, phase: 'grace' };
}

/**
 * Seconds left of the *booked* session.
 *
 * Goes negative during the grace period, which is what lets the UI say "running
 * over" rather than pretending there is time left. Billing never follows it
 * past zero.
 */
export function remainingSeconds(window: SessionWindow, now: Date): number {
  return Math.round((window.endUtc.getTime() - now.getTime()) / 1_000);
}

export function elapsedSeconds(window: SessionWindow, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - window.startUtc.getTime()) / 1_000));
}

/** Which warning, if any, should have fired by now. */
export function dueWarningMinutes(window: SessionWindow, now: Date): number | null {
  const remaining = remainingSeconds(window, now);
  for (const minutes of WARNING_MINUTES) {
    if (remaining <= minutes * 60 && remaining > (minutes - 1) * 60) return minutes;
  }
  return null;
}
