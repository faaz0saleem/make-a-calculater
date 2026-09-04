'use client';

/**
 * The classroom (SPEC.md §7).
 *
 * Built for the networks it will actually run on: Pakistani and Gulf mobile,
 * where 300ms round trips, 5% loss and a handover from wifi to cellular
 * mid-lesson are normal rather than exceptional. That shapes three decisions:
 *
 *  - The clock comes from the booking's scheduled start, so a reconnect cannot
 *    reset it.
 *  - A drop shows an explicit "reconnecting" panel, not a frozen last frame
 *    that leaves someone talking to a picture.
 *  - Poor quality turns the camera off automatically and says so, because a
 *    lesson survives losing video and does not survive losing audio.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionQuality,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteTrack,
  type Room,
} from 'livekit-client';

import { requestSessionToken } from '@/app/sessions/[bookingId]/actions';
import { PreCallCheck } from '@/components/classroom/pre-call-check';
import { TrialConversion, type TrialConversionProps } from '@/components/trials/trial-conversion';
import { formatDuration, useTick } from '@/components/classroom/session-clock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money/cents';
import { DOWNGRADE_NOTICE, qualityLabel, shouldDropVideo, type LinkQuality } from '@/lib/sessions/degrade';
import { dueWarningMinutes, joinState, remainingSeconds, sessionWindow } from '@/lib/sessions/window';
import { formatInTimeZone } from '@/lib/time';
import { cn } from '@/lib/utils';

type Stage = 'pre_call' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export type ClassroomProps = {
  bookingId: string;
  role: 'student' | 'tutor';
  otherName: string;
  otherAvatarUrl: string | null;
  viewerName: string;
  viewerTimezone: string;
  isTrial: boolean;
  priceCents: number;
  status: string;
  startUtcIso: string;
  endUtcIso: string;
  joinOpensUtcIso: string;
  joinClosesUtcIso: string;
  configured: boolean;
  /** Only for a student who has just taken a free trial (SPEC.md §6). */
  conversion: TrialConversionProps | null;
};

export function Classroom(props: ClassroomProps) {
  const window_ = sessionWindow(new Date(props.startUtcIso), Math.round(
    (new Date(props.endUtcIso).getTime() - new Date(props.startUtcIso).getTime()) / 60_000,
  ));

  const [stage, setStage] = useState<Stage>('pre_call');
  const [error, setError] = useState<string | null>(null);
  const [serverNowIso, setServerNowIso] = useState<string | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const [downgraded, setDowngraded] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [quality, setQuality] = useState<LinkQuality>('unknown');
  const [remoteJoined, setRemoteJoined] = useState(false);
  const [warning, setWarning] = useState<number | null>(null);

  const roomRef = useRef<Room | null>(null);
  // Set when someone presses leave, so an involuntary drop can be told apart
  // from a deliberate exit — they need very different screens.
  const leavingRef = useRef(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const now = useTick(serverNowIso);
  const remaining = remainingSeconds(window_, now);
  const state = joinState(window_, now);

  // Warnings at five minutes and one (SPEC.md §7).
  useEffect(() => {
    if (stage !== 'live') return;
    const due = dueWarningMinutes(window_, now);
    if (due !== null && due !== warning) setWarning(due);
  }, [now, stage, warning, window_]);

  const leave = useCallback(async () => {
    leavingRef.current = true;
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setStage('ended');
  }, []);

  const join = useCallback(
    async (options: { audioOnly: boolean }) => {
      setStage('connecting');
      setError(null);
      setAudioOnly(options.audioOnly);
      leavingRef.current = false;

      const ticket = await requestSessionToken(props.bookingId);
      if (!ticket.ok) {
        setError(ticket.error);
        setStage('error');
        return;
      }

      setServerNowIso(ticket.serverNowIso);

      try {
        const { Room: LiveKitRoom } = await import('livekit-client');

        const room = new LiveKitRoom({
          // Let LiveKit drop layers before it drops the call — on a lossy
          // mobile link that is the difference between grainy and frozen.
          adaptiveStream: true,
          dynacast: true,
          disconnectOnPageLeave: true,
        });
        roomRef.current = room;

        room
          .on(RoomEvent.Reconnecting, () => setStage('reconnecting'))
          .on(RoomEvent.Reconnected, () => setStage('live'))
          .on(RoomEvent.Disconnected, () => {
            // LiveKit gave up. If they did not ask to leave, say so and offer
            // the room back rather than telling them the lesson is over: it is
            // not, and the clock is still running against their money.
            if (leavingRef.current) {
              setStage('ended');
              return;
            }
            setError(
              'You were disconnected and we could not get you back in. The session is still running — ' +
                'check your connection and rejoin.',
            );
            setStage('error');
          })
          .on(RoomEvent.ParticipantConnected, () => setRemoteJoined(true))
          .on(RoomEvent.ParticipantDisconnected, () => setRemoteJoined(false))
          .on(RoomEvent.ConnectionQualityChanged, (value: ConnectionQuality, participant?: Participant) => {
            if (participant && participant !== room.localParticipant) return;
            setQuality(linkQuality(value));
          })
          .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
              track.attach(remoteVideoRef.current);
            }
            if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
              track.attach(remoteAudioRef.current);
            }
          })
          .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach())
          .on(RoomEvent.LocalTrackPublished, (publication: LocalTrackPublication) => {
            if (publication.kind === Track.Kind.Video && localVideoRef.current) {
              publication.track?.attach(localVideoRef.current);
            }
          });

        await room.connect(ticket.url, ticket.token);
        await room.localParticipant.setMicrophoneEnabled(true);

        if (!options.audioOnly) {
          await room.localParticipant.setCameraEnabled(true);
          setCameraOn(true);
        }

        setRemoteJoined(room.remoteParticipants.size > 0);
        setStage('live');
      } catch (caught) {
        console.error('could not join the session', caught);
        setError(
          'We could not connect you to the room. Your connection may have dropped — check it and try again. ' +
            'Nothing has been settled yet.',
        );
        setStage('error');
      }
    },
    [props.bookingId],
  );

  // Automatic downgrade: a lesson survives losing video, not losing audio.
  // The rule itself lives in `@/lib/sessions/degrade`, where it is tested.
  useEffect(() => {
    if (!shouldDropVideo({ quality, live: stage === 'live', audioOnly, alreadyDowngraded: downgraded })) {
      return;
    }

    const room = roomRef.current;
    if (!room) return;

    void room.localParticipant.setCameraEnabled(false).then(() => {
      setCameraOn(false);
      setDowngraded(true);
    });
  }, [audioOnly, downgraded, quality, stage]);

  useEffect(() => () => void roomRef.current?.disconnect(), []);

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  };

  const toggleCamera = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !cameraOn;
    await room.localParticipant.setCameraEnabled(next);
    setCameraOn(next);
    if (next) setDowngraded(false);
  };

  // ---------------------------------------------------------------------------

  if (!props.configured) {
    return (
      <Shell {...props}>
        <p role="alert" className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
          Video calling is not configured on this deployment, so this session cannot start. Nobody has been
          charged.
        </p>
      </Shell>
    );
  }

  if (stage === 'pre_call') {
    return (
      <Shell {...props}>
        <PreCallCheck
          onReady={(options) => void join(options)}
          disabled={!state.canJoin}
          disabledReason={
            state.canJoin
              ? null
              : state.phase === 'too_early'
                ? `The room opens five minutes before the session, at ${formatInTimeZone(window_.joinOpensUtc, props.viewerTimezone, { timeStyle: 'short' })}.`
                : 'This session has ended.'
          }
        />
      </Shell>
    );
  }

  if (stage === 'error') {
    return (
      <Shell {...props}>
        <div role="alert" className="flex flex-col gap-3 rounded-md bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
          <div className="flex flex-wrap gap-2">
            {state.canJoin ? (
              <Button size="sm" onClick={() => void join({ audioOnly })} data-testid="rejoin">
                Rejoin
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setStage('pre_call')}>
              Check my setup again
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  if (stage === 'ended') {
    return (
      <Shell {...props}>
        <div className="flex flex-col gap-5">
          {/* After a trial, the next booking is the point of the screen — so it
              comes first and everything else is a footnote (SPEC.md §6). */}
          {props.conversion ? <TrialConversion {...props.conversion} /> : null}

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Session ended</h2>
            <p className="text-sm text-muted-foreground">
              {props.isTrial
                ? 'That was a free trial, so no credits moved.'
                : `Your ${formatCents(props.priceCents)} is held until this time tomorrow, in case anything went wrong. It settles automatically after that.`}
            </p>
            <div className="flex gap-3">
              <Link href={props.role === 'tutor' ? '/tutor' : '/dashboard'}>
                <Button variant={props.conversion ? 'outline' : 'default'}>Back to your sessions</Button>
              </Link>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell {...props} compact>
      <div className="flex flex-col gap-3">
        {/* Status line: the clock, the connection, and who is here. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="rounded-md bg-secondary px-2 py-1 text-sm font-medium tabular-nums"
              aria-label={`${Math.abs(Math.round(remaining / 60))} minutes ${remaining < 0 ? 'over' : 'remaining'}`}
              data-testid="session-clock"
            >
              {formatDuration(remaining)}
            </span>
            {remaining < 0 ? <Badge variant="outline">Running over</Badge> : null}
            {props.isTrial ? <Badge variant="success">Free trial</Badge> : null}
          </div>

          <div className="flex items-center gap-2">
            <QualityPill quality={quality} stage={stage} />
            <Badge variant={remoteJoined ? 'success' : 'secondary'}>
              {remoteJoined ? `${props.otherName} is here` : `Waiting for ${props.otherName}`}
            </Badge>
          </div>
        </div>

        {warning !== null && remaining > 0 ? (
          <p role="status" aria-live="polite" className="rounded-md bg-secondary px-3 py-2 text-sm">
            {warning} {warning === 1 ? 'minute' : 'minutes'} left.
          </p>
        ) : null}

        {downgraded ? (
          <p role="status" aria-live="polite" className="rounded-md bg-secondary px-3 py-2 text-sm">
            {DOWNGRADE_NOTICE}
          </p>
        ) : null}

        {/* The video area. Stacked on a phone, side by side from `sm`. */}
        <div className="relative grid gap-2 sm:grid-cols-[3fr_1fr]">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              aria-label={`${props.otherName}'s camera`}
              className="size-full object-cover"
            />
            <audio ref={remoteAudioRef} autoPlay />

            {!remoteJoined ? (
              <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white/80">
                Waiting for {props.otherName} to join…
              </p>
            ) : null}

            {stage === 'reconnecting' ? (
              <div
                role="alert"
                aria-live="assertive"
                data-testid="reconnecting"
                className="absolute inset-0 grid place-items-center bg-black/80 p-4 text-center"
              >
                <div className="flex flex-col items-center gap-2">
                  <span className="text-base font-medium text-white">Reconnecting…</span>
                  <span className="max-w-xs text-sm text-white/70">
                    Your connection dropped. We are getting you back in — the session clock is still running.
                  </span>
                </div>
              </div>
            ) : null}

            {stage === 'connecting' ? (
              <p role="status" className="absolute inset-0 grid place-items-center text-sm text-white/80">
                Connecting…
              </p>
            ) : null}
          </div>

          <div className="relative aspect-video overflow-hidden rounded-lg bg-black sm:aspect-auto">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              aria-label="Your camera"
              className="size-full object-cover"
            />
            {!cameraOn ? (
              <p className="absolute inset-0 grid place-items-center text-xs text-white/70">Camera off</p>
            ) : null}
          </div>
        </div>

        {/* Controls. Large targets, because this is used on a phone. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={micOn ? 'secondary' : 'destructive'}
            onClick={() => void toggleMic()}
            aria-pressed={micOn}
            className="min-h-11"
          >
            {micOn ? 'Mute' : 'Unmute'}
          </Button>

          <Button
            variant="secondary"
            onClick={() => void toggleCamera()}
            aria-pressed={cameraOn}
            className="min-h-11"
          >
            {cameraOn ? 'Turn camera off' : 'Turn camera on'}
          </Button>

          <Button
            variant="destructive"
            onClick={() => void leave()}
            className="ml-auto min-h-11"
            data-testid="end-session"
          >
            {remaining > 0 ? 'Leave session' : 'End session'}
          </Button>
        </div>

        {remaining > 0 ? (
          <p className="text-xs text-muted-foreground">
            Leaving early does not end the booking — you can come back until{' '}
            {formatInTimeZone(window_.joinClosesUtc, props.viewerTimezone, { timeStyle: 'short' })}.
          </p>
        ) : null}
      </div>
    </Shell>
  );
}

/** LiveKit's enum, translated once at the boundary. */
function linkQuality(value: ConnectionQuality): LinkQuality {
  switch (value) {
    case ConnectionQuality.Excellent:
      return 'excellent';
    case ConnectionQuality.Good:
      return 'good';
    case ConnectionQuality.Poor:
      return 'poor';
    default:
      return 'unknown';
  }
}

function QualityPill({ quality, stage }: { quality: LinkQuality; stage: Stage }) {
  const reconnecting = stage === 'reconnecting';
  const label = qualityLabel(quality, reconnecting);

  return (
    <Badge
      variant={reconnecting || quality === 'poor' ? 'destructive' : 'secondary'}
      aria-label={`Connection ${label}`}
      data-testid="quality-pill"
    >
      {label}
    </Badge>
  );
}

function Shell({
  children,
  otherName,
  role,
  startUtcIso,
  endUtcIso,
  viewerTimezone,
  compact,
}: ClassroomProps & { children: React.ReactNode; compact?: boolean }) {
  return (
    <main className={cn('mx-auto w-full px-4 py-6 sm:px-6', compact ? 'max-w-5xl' : 'max-w-2xl')}>
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {role === 'tutor' ? `Session with ${otherName}` : `Lesson with ${otherName}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatInTimeZone(new Date(startUtcIso), viewerTimezone, {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
            {' – '}
            {formatInTimeZone(new Date(endUtcIso), viewerTimezone, { hour: 'numeric', minute: '2-digit' })}
            {' · '}
            {viewerTimezone}
          </p>
        </div>
        <Link
          href={role === 'tutor' ? '/tutor' : '/dashboard'}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Leave
        </Link>
      </header>

      {children}
    </main>
  );
}
