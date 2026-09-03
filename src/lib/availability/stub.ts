/**
 * The stand-in until Phase 3 builds the availability engine.
 *
 * Every method answers "unknown". Nothing here invents a slot, and nothing here
 * reads `availability_rules` — a half-expanded rule set that ignores exceptions,
 * buffers, lead times and existing bookings would produce slots that are not
 * really free, which is worse than silence.
 *
 * TODO(phase-3): delete this and register the real implementation. The
 * behaviour to match is SPEC.md §5.
 */

import { UNKNOWN, type Availability, type AvailabilityPort, type NextFreeSlot } from './port';

export class StubAvailability implements AvailabilityPort {
  readonly name = 'stub';

  async nextFreeSlot(): Promise<Availability<NextFreeSlot | null>> {
    return UNKNOWN;
  }

  async isAvailableToday(): Promise<Availability<boolean>> {
    return UNKNOWN;
  }

  async tutorsFreeWithin(): Promise<Availability<string[]>> {
    return UNKNOWN;
  }

  async densityNext7dBps(): Promise<Availability<Map<string, number>>> {
    return UNKNOWN;
  }
}
