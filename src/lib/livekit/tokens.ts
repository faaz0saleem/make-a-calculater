/**
 * Minting access tokens (SPEC.md §7).
 *
 * "Access tokens minted server-side only, valid start - 5min to end + 10min,
 * granted only to the two participant user IDs. Never mint a token from
 * client-supplied identity."
 *
 * So this function takes the booking as loaded from the database and the viewer
 * as resolved from the session. There is no parameter a browser could set.
 */

import { AccessToken } from 'livekit-server-sdk';

import { liveKitConfig, roomNameFor } from './config';
import { joinState, sessionWindow } from '@/lib/sessions/window';

export type TokenSubject = {
  bookingId: string;
  startAtUtc: Date;
  durationMinutes: number;
  studentId: string;
  tutorId: string;
};

export type MintedToken = {
  token: string;
  url: string;
  roomName: string;
  /** Server time when the token was minted, so the client can correct its clock. */
  serverNowIso: string;
  expiresAtIso: string;
};

export type MintFailure =
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'not_a_participant' }
  | { ok: false; reason: 'too_early'; opensInSeconds: number }
  | { ok: false; reason: 'over' };

export type MintResult = ({ ok: true } & MintedToken) | MintFailure;

export async function mintSessionToken(
  booking: TokenSubject,
  viewerId: string,
  viewerName: string,
  now = new Date(),
): Promise<MintResult> {
  const config = liveKitConfig();
  if (!config) return { ok: false, reason: 'not_configured' };

  // Only the two people on the booking, checked against the loaded row.
  const role = viewerId === booking.studentId ? 'student' : viewerId === booking.tutorId ? 'tutor' : null;
  if (!role) return { ok: false, reason: 'not_a_participant' };

  const window = sessionWindow(booking.startAtUtc, booking.durationMinutes);
  const state = joinState(window, now);
  if (!state.canJoin) {
    return state.phase === 'too_early'
      ? { ok: false, reason: 'too_early', opensInSeconds: state.opensInSeconds ?? 0 }
      : { ok: false, reason: 'over' };
  }

  // The token dies with the room's join window, so a copied one is useless
  // afterwards.
  const ttlSeconds = Math.max(60, Math.ceil((window.joinClosesUtc.getTime() - now.getTime()) / 1_000));
  const roomName = roomNameFor(booking.bookingId);

  const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
    identity: viewerId,
    name: viewerName,
    // Carried into every webhook, so the server can attribute events without
    // trusting anything the client said.
    metadata: JSON.stringify({ role, bookingId: booking.bookingId }),
    ttl: ttlSeconds,
  });

  accessToken.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // Nobody may invent a room or rename themselves.
    roomCreate: false,
    roomAdmin: false,
  });

  return {
    ok: true,
    token: await accessToken.toJwt(),
    url: config.url,
    roomName,
    serverNowIso: now.toISOString(),
    expiresAtIso: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
  };
}
