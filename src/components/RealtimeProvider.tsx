"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AppointmentView, CallView } from "./types";

export type RealtimeMessage =
  | { type: "call.incoming"; call: CallView }
  | { type: "call.updated"; call: CallView }
  | { type: "call.signal"; callId: string; from: string; kind: "ready" | "offer" | "answer" | "ice"; data?: unknown }
  | { type: "appointment.updated"; appointment: AppointmentView };

type Listener = (msg: RealtimeMessage) => void;

interface RealtimeContextValue {
  connected: boolean;
  /** Increments every time the stream (re)connects; events sent while it was down are lost. */
  epoch: number;
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const EVENTS = ["call.incoming", "call.updated", "call.signal", "appointment.updated"] as const;

/** One EventSource per tab, shared by everything under the Ndiho app layout. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    // EventSource reconnects on its own after network blips.
    const source = new EventSource("/api/realtime");
    source.addEventListener("ready", () => {
      setConnected(true);
      setEpoch((n) => n + 1);
    });
    source.onerror = () => setConnected(false);
    const onMessage = (e: Event) => {
      let msg: RealtimeMessage;
      try {
        msg = JSON.parse((e as MessageEvent).data);
      } catch {
        return;
      }
      listeners.current.forEach((l) => l(msg));
    };
    EVENTS.forEach((name) => source.addEventListener(name, onMessage));
    return () => source.close();
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return <RealtimeContext.Provider value={{ connected, epoch, subscribe }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used inside <RealtimeProvider>");
  return ctx;
}

/** Subscribes `listener` for the component's lifetime, always calling the latest version. */
export function useRealtimeEvents(listener: Listener) {
  const { subscribe } = useRealtime();
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => subscribe((msg) => ref.current(msg)), [subscribe]);
}
