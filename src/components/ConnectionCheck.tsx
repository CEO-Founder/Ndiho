"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import { Button } from "./ui";

type Status = "pending" | "running" | "ok" | "fail" | "skipped";

interface Check {
  key: string;
  label: string;
  detail: string;
  status: Status;
  note?: string;
}

const GATHER_TIMEOUT_MS = 8000;

/** Gathers candidates for one ICE server and reports whether `want` showed up. */
async function probe(server: RTCIceServer, policy: RTCIceTransportPolicy, want: "srflx" | "relay"): Promise<boolean> {
  const peer = new RTCPeerConnection({ iceServers: [server], iceTransportPolicy: policy });
  try {
    peer.createDataChannel("probe");
    const found = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), GATHER_TIMEOUT_MS);
      peer.onicecandidate = (e) => {
        if (e.candidate?.type === want) {
          clearTimeout(timer);
          resolve(true);
        } else if (!e.candidate) {
          clearTimeout(timer);
          resolve(false);
        }
      };
    });
    await peer.setLocalDescription(await peer.createOffer());
    return await found;
  } finally {
    peer.close();
  }
}

function turnKind(url: string): "udp" | "tcp" | "tls" {
  if (url.startsWith("turns:")) return "tls";
  return /transport=tcp/i.test(url) ? "tcp" : "udp";
}

export function ConnectionCheck() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const update = (key: string, patch: Partial<Check>) =>
    setChecks((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const stopMedia = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => stopMedia, [stopMedia]);

  // Microphone level meter.
  useEffect(() => {
    if (!running && !stream.current) return;
    const s = stream.current;
    if (!s || s.getAudioTracks().length === 0) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(s).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 64));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [running]);

  async function run() {
    setRunning(true);
    setMediaError(null);
    stopMedia();
    const initial: Check[] = [
      { key: "camera", label: "Camera", detail: "Video for your session", status: "running" },
      { key: "mic", label: "Microphone", detail: "Speak — the bar should move", status: "running" },
      { key: "stun", label: "Network discovery (STUN)", detail: "Finds a direct path between you and your therapist", status: "pending" },
    ];
    setChecks(initial);

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(async (err) => {
        if ((err as DOMException).name === "NotFoundError") return navigator.mediaDevices.getUserMedia({ audio: true });
        throw err;
      });
      stream.current = s;
      if (video.current) video.current.srcObject = s;
      setPreviewing(s.getVideoTracks().length > 0);
      update("camera", s.getVideoTracks().length ? { status: "ok", note: s.getVideoTracks()[0].label || "Working" } : { status: "fail", note: "No camera found — calls will be audio only" });
      update("mic", s.getAudioTracks().length ? { status: "ok", note: s.getAudioTracks()[0].label || "Working" } : { status: "fail", note: "No microphone found" });
    } catch (err) {
      const name = (err as DOMException).name;
      const msg =
        name === "NotAllowedError"
          ? "Access was blocked. Allow camera and microphone for this site in your browser settings, then run the test again."
          : !window.isSecureContext
            ? "Camera access needs a secure (HTTPS) connection."
            : errorMessage(err);
      setMediaError(msg);
      update("camera", { status: "fail", note: msg });
      update("mic", { status: "fail", note: msg });
    }

    let config: { iceServers: RTCIceServer[] };
    try {
      config = await api("/ice");
    } catch (err) {
      update("stun", { status: "fail", note: `Could not load connection settings: ${errorMessage(err)}` });
      setRunning(false);
      return;
    }

    const stunServers = config.iceServers.filter((s) => [s.urls].flat().some((u) => u.startsWith("stun:")));
    const turnServer = config.iceServers.find((s) => [s.urls].flat().some((u) => u.startsWith("turn")));
    const turnUrls = turnServer ? [turnServer.urls].flat().filter((u) => u.startsWith("turn")) : [];
    const turnChecks: Check[] = turnUrls.map((url) => {
      const kind = turnKind(url);
      return {
        key: url,
        label: `Relay server — ${kind === "udp" ? "UDP" : kind === "tcp" ? "TCP" : "TLS (port-443-style, firewall friendly)"}`,
        detail: url.replace(/^turns?:/, "").replace(/\?.*$/, ""),
        status: "pending",
      };
    });
    setChecks((cs) => [
      ...cs,
      ...(turnChecks.length
        ? turnChecks
        : [{ key: "turn", label: "Relay server (TURN)", detail: "Not configured", status: "skipped" as Status, note: "Calls between some networks (e.g. mobile data) may fail without it" }]),
    ]);

    update("stun", { status: "running" });
    const stunProbe = stunServers.length
      ? probe({ urls: stunServers.flatMap((s) => [s.urls].flat()) }, "all", "srflx")
      : Promise.resolve(false);
    const turnResults = await Promise.all(
      turnUrls.map((url) => {
        update(url, { status: "running" });
        return probe({ urls: url, username: turnServer!.username, credential: turnServer!.credential }, "relay", "relay").then((ok) => {
          update(url, ok ? { status: "ok", note: "Reachable" } : { status: "fail", note: "Not reachable from this network" });
          return { url, ok };
        });
      }),
    );
    const stunOk = await stunProbe;
    // Without NAT (e.g. a public IP) browsers report no separate "reflexive"
    // address; a working UDP relay to the same server proves UDP gets through.
    const udpRelayOk = turnResults.some((r) => r.ok && turnKind(r.url) === "udp");
    update(
      "stun",
      stunOk
        ? { status: "ok", note: "Direct connections possible" }
        : udpRelayOk
          ? { status: "ok", note: "UDP reaches the server (no NAT detected)" }
          : { status: "fail", note: "Blocked — calls will use the relay server" },
    );
    setRunning(false);
  }

  const done = checks.length > 0 && !running;
  const networkOk = checks.some((c) => (c.key === "stun" || c.key.startsWith("turn")) && c.status === "ok");
  const relayOk = checks.some((c) => c.key.startsWith("turn") && c.status === "ok");
  const mediaOk = checks.find((c) => c.key === "mic")?.status === "ok";

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-5 rounded-3xl bg-nd-surface-lowest p-5 shadow-[0_8px_32px_rgba(36,66,103,0.05)] sm:grid-cols-[240px_1fr] sm:p-7">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#0f1b2b] sm:aspect-[4/3]">
          <video ref={video} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          {!previewing && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-white/60">Camera preview</p>}
        </div>
        <div className="flex flex-col justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-nd-primary">Microphone level</p>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-nd-surface-low" role="meter" aria-label="Microphone level" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            {mediaError && <p role="alert" className="mt-3 text-sm text-red-600">{mediaError}</p>}
          </div>
          <Button onClick={run} disabled={running} className="self-start" data-testid="run-check">
            {running ? "Testing…" : checks.length ? "Run the test again" : "Start test"}
          </Button>
        </div>
      </section>

      {checks.length > 0 && (
        <section className="rounded-3xl bg-nd-surface-lowest p-5 shadow-[0_8px_32px_rgba(36,66,103,0.05)] sm:p-7">
          <ul className="flex flex-col divide-y divide-nd-surface-highest/60">
            {checks.map((c) => (
              <li key={c.key} data-testid={`check-${c.key}`} data-status={c.status} className="flex items-start gap-3 py-3">
                <span aria-hidden className="mt-0.5 w-6 text-center text-lg">
                  {c.status === "ok" ? "✅" : c.status === "fail" ? "❌" : c.status === "skipped" ? "⚠️" : c.status === "running" ? "⏳" : "•"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-nd-primary">{c.label}</p>
                  <p className="truncate text-xs text-nd-muted">{c.detail}</p>
                  {c.note && <p className="mt-0.5 text-sm text-nd-on-background/80">{c.note}</p>}
                </div>
              </li>
            ))}
          </ul>
          {done && (
            <p
              role="status"
              data-testid="check-verdict"
              className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium ${networkOk && mediaOk ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
            >
              {networkOk && mediaOk
                ? relayOk
                  ? "You're all set: video calls will work from this device and network."
                  : "Your device works. Direct calls are possible, but the relay server isn't reachable, so calls to some networks may fail."
                : !mediaOk
                  ? "Your camera or microphone isn't available. Fix the issue above and run the test again."
                  : "Your network is blocking video calls. Try another network (for example mobile data), or contact support."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
