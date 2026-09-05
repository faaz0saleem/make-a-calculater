/**
 * LiveKit configuration (SPEC.md §7, §14).
 *
 * Without keys the classroom refuses to start rather than half-working: a
 * student should be told the call cannot be set up, not dropped into a room
 * that will never connect.
 */

export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
};

export function liveKitConfig(): LiveKitConfig | null {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

export function isLiveKitConfigured(): boolean {
  return liveKitConfig() !== null;
}

export const LIVEKIT_UNCONFIGURED_MESSAGE =
  'Video calling is not configured on this deployment, so this session cannot start. Nobody has been charged.';

/** One room per booking (SPEC.md §7). */
export function roomNameFor(bookingId: string): string {
  return `booking_${bookingId}`;
}

export function bookingIdFromRoom(roomName: string): string | null {
  return roomName.startsWith('booking_') ? roomName.slice('booking_'.length) : null;
}
