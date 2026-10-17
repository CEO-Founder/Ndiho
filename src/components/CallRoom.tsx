"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import { useRealtime, useRealtimeEvents } from "./RealtimeProvider";
import type { CallView } from "./types";
import { Avatar, Button, LinkButton } from "./ui";

type Phase = "media" | "ringing" | "connecting" | "connected" | "reconnecting" | "ended" | "error";

/** How media is flowing, from the selected ICE candidate pair. */
type Route = "direct" | "relay-udp" | "relay-tcp" | "relay-tls" | null;

interface IceConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
}

// Signal payloads. Every negotiation (a fresh RTCPeerConnection on the caller)
// has an id; answers and ICE candidates from an older negotiation are ignored.
type SdpSignal = { negId: number; sdp: RTCSessionDescriptionInit };
type IceSignal = { negId: number; candidate: RTCIceCandidateInit };

const HEARTBEAT_MS = 15_000;
const POLL_MS = 5_000;
const READY_RETRY_MS = 2_000;
// Caller re-sends a fresh offer if no answer arrives in this time.
const ANSWER_TIMEOUT_MS = 10_000;
// "disconnected" often heals by itself; after this long the caller restarts ICE.
const DISCONNECTED_GRACE_MS = 4_000;
// If the connection still isn't up this long after a failure, start over.
const RECOVERY_TIMEOUT_MS = 12_000;
// Unmount hang-ups are deferred by this much so an immediate remount (React
// StrictMode in development, or a fast re-render of the route) can cancel them.
const HANGUP_GRACE_MS = 300;
const pendingHangups = new Map<string, ReturnType<typeof setTimeout>>();

const END_MESSAGES: Record<string, string> = {
  rejected: "The call was declined.",
  cancelled: "The call was cancelled.",
  missed: "No answer. Please try again later.",
  ended: "The call has ended.",
};

/**
 * Negotiation protocol (signals are relayed by the server, in order):
 *   - Each side sends "ready" once it is in the room with local media.
 *   - The caller is always the offerer: on "ready" it creates a fresh peer
 *     connection with a new negotiation id and sends an "offer".
 *   - The callee answers a "ready" with its own "ready" (so a caller who joins
 *     late still triggers negotiation) and answers each "offer". An offer with
 *     a new negotiation id gets a fresh peer connection; the same id is an ICE
 *     restart on the existing one.
 *   - ICE candidates trickle both ways and are queued until the remote
 *     description is set.
 *   - Recovery: "disconnected" → the caller restarts ICE after a grace period;
 *     still down after RECOVERY_TIMEOUT_MS → full renegotiation. A lost offer
 *     or answer is re-sent; a reconnected event stream triggers renegotiation.
 */
export function CallRoom({ callId, me }: { callId: string; me: string }) {
  const { epoch } = useRealtime();
  const [call, setCall] = useState<CallView | null>(null);
  const [phase, setPhase] = useState<Phase>("media");
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasVideo, setHasVideo] = useState(true);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [route, setRoute] = useState<Route>(null);
  const [elapsed, setElapsed] = useState(0);

  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const negId = useRef(0);
  const pendingIce = useRef<IceSignal[]>([]);
  const sendChain = useRef<Promise<unknown>>(Promise.resolve());
  const gotOffer = useRef(false);
  const ended = useRef(false);
  const iceConfig = useRef<IceConfig>({ iceServers: [], iceTransportPolicy: "all" });
  const answerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every mount/unmount so async work from a stale mount is dropped.
  const mountGen = useRef(0);

  const isCaller = call ? call.callerId === me : false;
  const isCallerRef = useRef(false);
  isCallerRef.current = isCaller;
  const other = call ? (call.therapist.id === me ? call.patient : call.therapist) : null;

  // Signals are POSTed one at a time so the other side receives them in order.
  const signal = useCallback(
    (kind: "ready" | "offer" | "answer" | "ice", data?: unknown) => {
      sendChain.current = sendChain.current
        .then(() => api(`/calls/${callId}/signal`, { body: { kind, data } }))
        .catch((err) => console.warn("[ndiho] signal failed", kind, err));
      return sendChain.current;
    },
    [callId],
  );

  const clearTimers = useCallback(() => {
    for (const t of [answerTimer, restartTimer, recoveryTimer]) {
      if (t.current) clearTimeout(t.current);
      t.current = null;
    }
  }, []);

  const closePeer = useCallback(() => {
    clearTimers();
    pc.current?.close();
    pc.current = null;
  }, [clearTimers]);

  const teardown = useCallback(
    (finalCall?: CallView) => {
      if (ended.current) return;
      ended.current = true;
      closePeer();
      localStream.current?.getTracks().forEach((t) => t.stop());
      if (finalCall) setCall(finalCall);
      setPhase("ended");
    },
    [closePeer],
  );

  const flushIce = useCallback(async () => {
    const peer = pc.current;
    if (!peer?.remoteDescription) return;
    const current = negId.current;
    const ready = pendingIce.current.filter((c) => c.negId === current);
    // Keep candidates for a newer negotiation whose offer hasn't arrived yet.
    pendingIce.current = pendingIce.current.filter((c) => c.negId > current);
    for (const c of ready) {
      await peer.addIceCandidate(c.candidate).catch((err) => console.warn("[ndiho] bad ICE candidate", err));
    }
  }, []);

  // Forward-declared so peer event handlers can trigger recovery.
  const renegotiateRef = useRef<() => void>(() => {});
  const restartIceRef = useRef<() => void>(() => {});

  const scheduleRecovery = useCallback(() => {
    if (recoveryTimer.current) return;
    recoveryTimer.current = setTimeout(() => {
      recoveryTimer.current = null;
      if (ended.current || pc.current?.connectionState === "connected") return;
      renegotiateRef.current();
    }, RECOVERY_TIMEOUT_MS);
  }, []);

  const createPeer = useCallback(
    (id: number) => {
      closePeer();
      negId.current = id;
      const peer = new RTCPeerConnection({
        iceServers: iceConfig.current.iceServers,
        iceTransportPolicy: iceConfig.current.iceTransportPolicy,
      });
      localStream.current?.getTracks().forEach((t) => peer.addTrack(t, localStream.current!));
      peer.onicecandidate = (e) => {
        if (e.candidate) signal("ice", { negId: id, candidate: e.candidate.toJSON() } satisfies IceSignal);
      };
      peer.ontrack = (e) => {
        const [stream] = e.streams;
        const video = remoteVideo.current;
        if (video && stream && video.srcObject !== stream) {
          video.srcObject = stream;
          // Mobile browsers may block audio autoplay without a recent tap.
          video.play().then(
            () => setNeedsTap(false),
            () => setNeedsTap(true),
          );
        }
        if (e.track.kind === "video") setRemoteHasVideo(true);
      };
      peer.onconnectionstatechange = () => {
        if (pc.current !== peer) return;
        const state = peer.connectionState;
        if (state === "connected") {
          clearTimers();
          setPhase("connected");
        } else if (state === "disconnected") {
          setPhase("reconnecting");
          if (isCallerRef.current && !restartTimer.current) {
            restartTimer.current = setTimeout(() => {
              restartTimer.current = null;
              if (pc.current === peer && peer.connectionState === "disconnected") restartIceRef.current();
            }, DISCONNECTED_GRACE_MS);
          }
          scheduleRecovery();
        } else if (state === "failed") {
          setPhase("reconnecting");
          if (isCallerRef.current) restartIceRef.current();
          scheduleRecovery();
        }
      };
      pc.current = peer;
      return peer;
    },
    [closePeer, clearTimers, scheduleRecovery, signal],
  );

  const sendOffer = useCallback(
    async (peer: RTCPeerConnection, opts?: RTCOfferOptions) => {
      const offer = await peer.createOffer(opts);
      await peer.setLocalDescription(offer);
      await signal("offer", { negId: negId.current, sdp: peer.localDescription!.toJSON() } satisfies SdpSignal);
      // If the answer is lost (e.g. the other side's stream was reconnecting), start over.
      if (answerTimer.current) clearTimeout(answerTimer.current);
      answerTimer.current = setTimeout(() => {
        answerTimer.current = null;
        if (!ended.current && pc.current === peer && peer.signalingState === "have-local-offer") renegotiateRef.current();
      }, ANSWER_TIMEOUT_MS);
    },
    [signal],
  );

  /** Caller: fresh peer connection and offer. Callee: ask the caller for one. */
  const renegotiate = useCallback(() => {
    if (ended.current || !localStream.current) return;
    if (isCallerRef.current) {
      // Time-based ids stay increasing even if the caller reloads the page.
      const peer = createPeer(Math.max(Date.now(), negId.current + 1));
      sendOffer(peer).catch((err) => console.error("[ndiho] offer failed", err));
    } else {
      signal("ready");
    }
  }, [createPeer, sendOffer, signal]);
  renegotiateRef.current = renegotiate;

  restartIceRef.current = () => {
    const peer = pc.current;
    if (!peer || peer.signalingState !== "stable") return;
    sendOffer(peer, { iceRestart: true }).catch((err) => console.warn("[ndiho] ICE restart failed", err));
  };

  // ─── Realtime events ──────────────────────────────────────────────────────

  useRealtimeEvents(async (msg) => {
    if (ended.current) return;
    if (msg.type === "call.updated" && msg.call.id === callId) {
      setCall(msg.call);
      if (msg.call.status === "accepted") {
        setPhase((p) => (p === "ringing" ? "connecting" : p));
      } else if (msg.call.status !== "ringing") {
        teardown(msg.call);
      }
      return;
    }
    if (msg.type !== "call.signal" || msg.callId !== callId || !localStream.current) return;
    try {
      if (msg.kind === "ready") {
        if (isCallerRef.current) renegotiate();
        else signal("ready");
      } else if (msg.kind === "offer" && !isCallerRef.current) {
        const { negId: id, sdp } = msg.data as SdpSignal;
        if (id < negId.current) return; // stale
        gotOffer.current = true;
        const reuse = id === negId.current && pc.current && pc.current.connectionState !== "closed";
        const peer = reuse ? pc.current! : createPeer(id);
        await peer.setRemoteDescription(sdp);
        await flushIce();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await signal("answer", { negId: id, sdp: peer.localDescription!.toJSON() } satisfies SdpSignal);
      } else if (msg.kind === "answer" && isCallerRef.current && pc.current) {
        const { negId: id, sdp } = msg.data as SdpSignal;
        if (id !== negId.current || pc.current.signalingState !== "have-local-offer") return;
        if (answerTimer.current) clearTimeout(answerTimer.current);
        answerTimer.current = null;
        await pc.current.setRemoteDescription(sdp);
        await flushIce();
      } else if (msg.kind === "ice") {
        const c = msg.data as IceSignal;
        if (c.negId < negId.current && isCallerRef.current) return;
        pendingIce.current.push(c);
        await flushIce();
      }
    } catch (err) {
      console.error("[ndiho] negotiation error", err);
    }
  });

  // Events sent while our stream was reconnecting are lost: renegotiate.
  const firstEpoch = useRef<number | null>(null);
  useEffect(() => {
    if (firstEpoch.current === null) {
      firstEpoch.current = epoch;
      return;
    }
    if (epoch !== firstEpoch.current && call?.status === "accepted" && phase !== "connected" && phase !== "ended") {
      renegotiate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  // Which path media takes: shown to users and used by the end-to-end tests.
  useEffect(() => {
    if (phase !== "connected") return;
    let cancelled = false;
    const check = async () => {
      const peer = pc.current;
      if (!peer) return;
      const next = await currentRoute(peer).catch(() => null);
      if (!cancelled) setRoute(next);
    };
    check();
    const t = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [phase]);

  // ─── Setup: load call, acquire media ──────────────────────────────────────

  const acquireMedia = useCallback(async (gen: number) => {
    setError(null);
    setPhase("media");
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        });
        setHasVideo(true);
      } catch (err) {
        // No camera (or camera denied): fall back to an audio-only call.
        if ((err as DOMException).name === "NotAllowedError" && !(await micAllowed())) throw err;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setHasVideo(false);
        setCamOn(false);
      }
      if (gen !== mountGen.current) {
        // This mount was torn down while the permission prompt was open.
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      localStream.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;
      return true;
    } catch (err) {
      const name = (err as DOMException).name;
      setError(
        name === "NotAllowedError"
          ? "Ndiho Space needs access to your microphone (and camera, for video). Allow access in your browser's address bar, then try again."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one and try again."
            : !window.isSecureContext
              ? "Video calls need a secure (HTTPS) connection."
              : `Could not start your camera or microphone (${errorMessage(err)}).`,
      );
      setPhase("error");
      return false;
    }
  }, []);

  const onCallLoaded = useCallback(async (current: CallView, gen: number) => {
    setCall(current);
    if (current.status !== "ringing" && current.status !== "accepted") {
      teardown(current);
      return;
    }
    try {
      iceConfig.current = await api<IceConfig>("/ice");
    } catch (err) {
      // Without STUN/TURN only same-network calls can connect, so say so.
      console.error("[ndiho] could not load ICE servers", err);
    }
    if (!(await acquireMedia(gen)) || ended.current) return;
    if (current.status === "ringing") {
      setPhase("ringing");
    } else {
      setPhase("connecting");
      signal("ready");
    }
  }, [acquireMedia, signal, teardown]);

  useEffect(() => {
    const pending = pendingHangups.get(callId);
    if (pending) {
      clearTimeout(pending);
      pendingHangups.delete(callId);
    }
    ended.current = false;
    const gen = ++mountGen.current;
    api<{ call: CallView }>(`/calls/${callId}`).then(
      ({ call: current }) => {
        if (gen === mountGen.current) void onCallLoaded(current, gen);
      },
      (err) => {
        if (gen !== mountGen.current) return;
        setError(errorMessage(err));
        setPhase("error");
      },
    );
    return () => {
      // Invalidating the generation is the point here, so reading the live ref is intended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      mountGen.current++;
      closePeer();
      pendingIce.current = [];
      gotOffer.current = false;
      localStream.current?.getTracks().forEach((t) => t.stop());
      localStream.current = null;
      // Leaving the page (client-side navigation) hangs up.
      if (!ended.current) {
        pendingHangups.set(
          callId,
          setTimeout(() => {
            pendingHangups.delete(callId);
            fetch(`/api/calls/${callId}/end`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
              keepalive: true,
            });
          }, HANGUP_GRACE_MS),
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // Closing the tab hangs up too.
  useEffect(() => {
    const onHide = () => {
      if (ended.current) return;
      navigator.sendBeacon(`/api/calls/${callId}/end`, new Blob(["{}"], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [callId]);

  // The callee keeps announcing "ready" until the caller's offer arrives, in
  // case the caller's room loaded after the first announcement.
  useEffect(() => {
    if (phase !== "connecting" || isCaller || !call || call.status !== "accepted") return;
    const t = setInterval(() => {
      if (!gotOffer.current) signal("ready");
    }, READY_RETRY_MS);
    return () => clearInterval(t);
  }, [phase, isCaller, call, signal]);

  // Heartbeats keep the server from treating the call as dropped.
  useEffect(() => {
    if (call?.status !== "accepted" || phase === "ended") return;
    const t = setInterval(() => {
      api(`/calls/${callId}/heartbeat`, { body: {} }).catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [call?.status, phase, callId]);

  // Poll as a fallback in case a realtime event was missed while reconnecting.
  useEffect(() => {
    if (phase === "ended" || phase === "error") return;
    const t = setInterval(async () => {
      try {
        const { call: fresh } = await api<{ call: CallView }>(`/calls/${callId}`);
        if (ended.current) return;
        if (fresh.status === "accepted" && call?.status === "ringing") {
          setCall(fresh);
          setPhase((p) => (p === "ringing" ? "connecting" : p));
        } else if (fresh.status !== "ringing" && fresh.status !== "accepted") {
          teardown(fresh);
        }
      } catch {
        // transient; try again next tick
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [phase, callId, call?.status, teardown]);

  // The caller gives up when the ring timeout passes.
  useEffect(() => {
    if (phase !== "ringing" || !call || !isCaller) return;
    const remaining = new Date(call.createdAt).getTime() + call.ringTimeoutSeconds * 1000 - Date.now();
    const t = setTimeout(() => hangUp(), Math.max(remaining, 0) + 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, call, isCaller]);

  // Call timer.
  useEffect(() => {
    if (phase !== "connected" && phase !== "reconnecting") return;
    const startedAt = call?.answeredAt ? new Date(call.answeredAt).getTime() : Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, call?.answeredAt]);

  // Re-attach the local preview if the video element remounts.
  useEffect(() => {
    if (localVideo.current && localStream.current && localVideo.current.srcObject !== localStream.current) {
      localVideo.current.srcObject = localStream.current;
    }
  });

  async function hangUp() {
    if (ended.current) return;
    try {
      const { call: final } = await api<{ call: CallView }>(`/calls/${callId}/end`, { body: {} });
      teardown(final);
    } catch {
      teardown();
    }
  }

  function toggleMic() {
    const next = !micOn;
    localStream.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }

  function toggleCam() {
    const next = !camOn;
    localStream.current?.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (phase === "ended" || (phase === "error" && !call)) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
        <div className="mb-4 text-6xl">{call?.status === "ended" ? "🌿" : "📞"}</div>
        <h1 className="font-nd-serif text-3xl font-bold text-nd-primary">
          {call?.status === "ended" ? "Session ended" : error ? "Call unavailable" : "Call ended"}
        </h1>
        <p className="mt-3 text-nd-muted">{error ?? (call ? END_MESSAGES[call.status] : "")}</p>
        {call?.status === "ended" && elapsed > 0 && (
          <p className="mt-1 text-sm text-nd-muted">Duration {formatDuration(elapsed)}</p>
        )}
        <LinkButton href="/dashboard" className="mt-8">Back to dashboard</LinkButton>
      </div>
    );
  }

  const statusText: Record<Phase, string> = {
    media: "Starting your camera…",
    ringing: isCaller ? `Calling ${other?.fullName ?? ""}…` : "Connecting…",
    connecting: "Connecting securely…",
    connected: formatDuration(elapsed),
    reconnecting: "Connection unstable — reconnecting…",
    ended: "",
    error: "",
  };

  return (
    <div className="relative flex h-[calc(100dvh-4rem)] flex-col bg-[#0f1b2b] text-white">
      {/* Remote video (or a placeholder until it arrives) */}
      <div className="relative flex-1 overflow-hidden">
        <video ref={remoteVideo} autoPlay playsInline data-testid="remote-video" className={`h-full w-full object-cover ${remoteHasVideo && phase === "connected" ? "" : "invisible"}`} />
        {!(remoteHasVideo && phase === "connected") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            {other && (
              <div className="relative">
                {phase === "ringing" && <span className="absolute inset-0 animate-ping rounded-full bg-nd-primary-light/60" />}
                <Avatar name={other.fullName} size={112} className="relative ring-4 ring-white/10" />
              </div>
            )}
            <p className="font-nd-serif text-2xl font-bold">{other?.fullName}</p>
            <p className="text-sm text-white/70" aria-live="polite">{statusText[phase]}</p>
          </div>
        )}

        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-xs font-semibold backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${phase === "connected" ? "bg-emerald-400" : phase === "reconnecting" ? "bg-amber-400" : "bg-white/60"}`} />
          <span data-testid="call-status">{phase === "connected" ? `Live · ${statusText.connected}` : statusText[phase]}</span>
          {phase === "connected" && route && (
            <span data-testid="call-route" data-route={route} className="border-l border-white/20 pl-2 font-normal text-white/70">
              {route === "direct" ? "Direct" : "Relayed"}
            </span>
          )}
        </div>
        {needsTap && (
          <button
            onClick={() => remoteVideo.current?.play().then(() => setNeedsTap(false), () => {})}
            className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-6 py-3 font-semibold text-nd-primary shadow-xl"
          >
            🔊 Tap to turn on sound
          </button>
        )}
        <div className="absolute right-4 top-4 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white/80 backdrop-blur">🔒 End-to-end encrypted (DTLS-SRTP)</div>

        {/* Local preview */}
        <div className="absolute bottom-28 right-4 aspect-[3/4] w-28 overflow-hidden rounded-2xl bg-black/60 shadow-2xl ring-1 ring-white/20 sm:bottom-6 sm:aspect-video sm:w-56">
          <video ref={localVideo} autoPlay playsInline muted className={`h-full w-full -scale-x-100 object-cover ${hasVideo && camOn ? "" : "invisible"}`} />
          {!(hasVideo && camOn) && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">{hasVideo ? "Camera off" : "Audio only"}</div>
          )}
        </div>

        {phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0f1b2b]/90 p-6">
            <div className="max-w-md rounded-3xl bg-white p-6 text-center text-nd-on-background">
              <p className="mb-2 text-4xl">🎙️</p>
              <p className="font-bold text-nd-primary">Camera & microphone needed</p>
              <p className="mt-2 text-sm text-nd-muted">{error}</p>
              <div className="mt-5 flex justify-center gap-3">
                <Button variant="outline" onClick={hangUp}>Leave</Button>
                <Button onClick={() => acquireMedia(mountGen.current).then((ok) => ok && call && (call.status === "accepted" ? (setPhase("connecting"), signal("ready")) : setPhase("ringing")))}>Try again</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 bg-[#0b1522] px-4 py-4 sm:gap-4">
        <ControlButton label={micOn ? "Mute microphone" : "Unmute microphone"} active={micOn} onClick={toggleMic} icon={micOn ? "🎙️" : "🔇"} />
        <ControlButton label={camOn ? "Turn camera off" : "Turn camera on"} active={camOn} disabled={!hasVideo} onClick={toggleCam} icon={camOn ? "📹" : "🚫"} />
        <button onClick={hangUp} aria-label={phase === "ringing" && isCaller ? "Cancel call" : "End call"} className="flex h-14 items-center gap-2 rounded-full bg-red-600 px-6 font-semibold transition hover:bg-red-700">
          <span aria-hidden>📞</span>
          <span className="hidden sm:inline">{phase === "ringing" && isCaller ? "Cancel" : "End call"}</span>
        </button>
      </div>
    </div>
  );
}

function ControlButton({ label, icon, active, disabled, onClick }: { label: string; icon: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={!active}
      title={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full text-xl transition disabled:opacity-40 ${active ? "bg-white/10 hover:bg-white/20" : "bg-white text-nd-primary"}`}
    >
      {icon}
    </button>
  );
}

function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

async function micAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state !== "denied";
  } catch {
    return true;
  }
}

/** Reads the selected candidate pair to tell direct (host/srflx) from TURN-relayed media. */
async function currentRoute(peer: RTCPeerConnection): Promise<Route> {
  const stats = await peer.getStats();
  let pairId: string | undefined;
  stats.forEach((r) => {
    if (r.type === "transport" && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
  });
  let pair: RTCIceCandidatePairStats | undefined;
  stats.forEach((r) => {
    if (r.type === "candidate-pair" && (r.id === pairId || (!pairId && r.state === "succeeded" && r.nominated))) pair = r;
  });
  if (!pair) return null;
  const local = stats.get(pair.localCandidateId);
  if (!local) return null;
  if (local.candidateType !== "relay") return "direct";
  const proto = (local.relayProtocol ?? "udp") as string;
  return proto === "tls" ? "relay-tls" : proto === "tcp" ? "relay-tcp" : "relay-udp";
}
