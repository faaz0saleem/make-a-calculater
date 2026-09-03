/**
 * The availability port discovery reads from.
 *
 * TODO(phase-3): swap `StubAvailability` for the real engine described in
 * SPEC.md §5. This function is the only place that needs to change.
 */

import type { AvailabilityPort } from './port';
import { StubAvailability } from './stub';

export * from './port';
export { StubAvailability } from './stub';

let cached: AvailabilityPort | null = null;

export function getAvailability(): AvailabilityPort {
  cached ??= new StubAvailability();
  return cached;
}

/** Lets tests and the ranking job run against a fake. */
export function setAvailability(port: AvailabilityPort | null): void {
  cached = port;
}
