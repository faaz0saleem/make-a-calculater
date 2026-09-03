/**
 * The availability port discovery and booking read from.
 *
 * `DatabaseAvailability` is the real one (SPEC.md §5). `setAvailability` lets a
 * test swap in `StubAvailability`, which knows nothing, to prove that callers
 * behave when the calendar has no answer.
 */

import { DatabaseAvailability } from './database';
import type { AvailabilityPort } from './port';

export * from './port';
export { StubAvailability } from './stub';
export { DatabaseAvailability } from './database';
export * from './engine';

let cached: AvailabilityPort | null = null;

export function getAvailability(): AvailabilityPort {
  cached ??= new DatabaseAvailability();
  return cached;
}

/** Lets tests and the ranking job run against a different implementation. */
export function setAvailability(port: AvailabilityPort | null): void {
  cached = port;
}
