/**
 * The LiveKit webhook (SPEC.md §7).
 *
 * This is where attendance comes from, and the only place it comes from. The
 * body is verified against the API secret before anything is written, so a
 * forged POST cannot manufacture a session somebody gets paid for.
 *
 * Participant identity is the user id we minted the token with — LiveKit echoes
 * it back — so an event is attributed without trusting a client-supplied name.
 */

import { WebhookReceiver } from 'livekit-server-sdk';

import { markInProgressIfNeeded, recordSessionEvent } from '@/db/sessions';
import { bookingIdFromRoom, liveKitConfig } from '@/lib/livekit/config';
import type { SessionEventKind } from '@/lib/sessions/attendance';

export const dynamic = 'force-dynamic';

/** LiveKit's event names, mapped to the four we store. */
const EVENTS: Record<string, SessionEventKind> = {
  room_started: 'room_started',
  room_finished: 'room_finished',
  participant_joined: 'participant_joined',
  participant_left: 'participant_left',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const config = liveKitConfig();
  if (!config) {
    // Nothing to verify against: refuse rather than accept unsigned events.
    return new Response('Not found', { status: 404 });
  }

  const body = await request.text();
  const authorization = request.headers.get('authorization') ?? '';

  let event;
  try {
    const receiver = new WebhookReceiver(config.apiKey, config.apiSecret);
    event = await receiver.receive(body, authorization);
  } catch {
    return new Response('Bad signature', { status: 401 });
  }

  const kind = EVENTS[event.event];
  const roomName = event.room?.name;
  if (!kind || !roomName) {
    // An event we do not model. Acknowledged so LiveKit stops retrying.
    return Response.json({ ok: true, ignored: true });
  }

  const bookingId = bookingIdFromRoom(roomName);
  if (!bookingId || !UUID.test(bookingId)) {
    return Response.json({ ok: true, ignored: true });
  }

  // Participant identity is the user id the token was minted with.
  const identity = event.participant?.identity ?? null;
  const userId = identity && UUID.test(identity) ? identity : null;

  // LiveKit timestamps are seconds; fall back to arrival time if absent.
  const atUtc = event.createdAt ? new Date(Number(event.createdAt) * 1_000) : new Date();

  try {
    const { inserted } = await recordSessionEvent({
      bookingId,
      event: kind,
      userId,
      atUtc,
      raw: event,
      externalId: event.id ?? `${roomName}:${kind}:${identity ?? 'room'}:${atUtc.toISOString()}`,
    });

    // Somebody actually arrived, so the booking is under way.
    if (inserted && kind === 'participant_joined') {
      await markInProgressIfNeeded(bookingId);
    }

    return Response.json({ ok: true, recorded: inserted });
  } catch (error) {
    // A foreign key failure means the room does not match a booking. Do not ask
    // LiveKit to retry something that will never succeed.
    console.error('livekit webhook could not be recorded', error);
    return Response.json({ ok: true, ignored: true });
  }
}
