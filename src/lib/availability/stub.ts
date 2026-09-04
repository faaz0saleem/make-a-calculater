/**
 * A calendar that knows nothing.
 *
 * Kept after the real engine landed, for tests that need to prove callers
 * behave when availability is unknown — the badge absent, the rail honest, the
 * ranking term neutral. `setAvailability` swaps it in.
 */

import {
  UNKNOWN,
  type Availability,
  type AvailabilityPort,
  type NextFreeSlot,
  type WeeklySignals,
} from './port';

export class StubAvailability implements AvailabilityPort {
  readonly name = 'stub';

  async freeSlotsFor(): Promise<Availability<NextFreeSlot[]>> {
    return UNKNOWN;
  }

  async nextFreeSlot(): Promise<Availability<NextFreeSlot | null>> {
    return UNKNOWN;
  }

  async isAvailableToday(): Promise<Availability<boolean>> {
    return UNKNOWN;
  }

  async tutorsFreeWithin(): Promise<Availability<string[]>> {
    return UNKNOWN;
  }

  async weeklySignals(): Promise<Availability<Map<string, WeeklySignals>>> {
    return UNKNOWN;
  }

  async tutorsFreeBetween(): Promise<Availability<string[]>> {
    return UNKNOWN;
  }
}
