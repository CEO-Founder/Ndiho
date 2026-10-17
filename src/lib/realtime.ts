import "server-only";

// In-process pub/sub keyed by user id, delivered to browsers over Server-Sent
// Events (GET /api/realtime). Every event is addressed to a single user,
// and a user's stream only ever receives that user's events, so authorization
// is decided once, server-side, when an event is published.
//
// This works for one Node process (the `output: "standalone"` deployment). To
// run several instances, replace `publish`/`subscribe` with a shared bus such
// as Postgres LISTEN/NOTIFY, Redis or Pusher — callers don't need to change.

export type RealtimeEvent =
  | { type: "call.incoming"; call: unknown }
  | { type: "call.updated"; call: unknown }
  | { type: "call.signal"; callId: string; from: string; kind: string; data?: unknown };

type Listener = (event: RealtimeEvent) => void;

const globalForBroker = globalThis as unknown as {
  __ndihoBroker?: Map<string, Set<Listener>>;
};
const listeners = (globalForBroker.__ndihoBroker ??= new Map());

export function publish(userId: string, event: RealtimeEvent): number {
  const set = listeners.get(userId);
  if (!set) return 0;
  for (const listener of set) {
    try {
      listener(event);
    } catch (err) {
      console.error("[ndiho] realtime listener failed", err);
    }
  }
  return set.size;
}

export function subscribe(userId: string, listener: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(userId);
  };
}

export function isOnline(userId: string): boolean {
  return (listeners.get(userId)?.size ?? 0) > 0;
}
