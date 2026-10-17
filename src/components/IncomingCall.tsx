"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "./api";
import { useRealtimeEvents } from "./RealtimeProvider";
import type { CallView } from "./types";
import { Avatar, Button } from "./ui";

/** Global incoming-call prompt for the signed-in user. */
export function IncomingCall({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [call, setCall] = useState<CallView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useRealtimeEvents((msg) => {
    if (msg.type === "call.incoming" && msg.call.callerId !== userId) {
      setCall(msg.call);
      setError(null);
    } else if (msg.type === "call.updated" && msg.call.id === call?.id && msg.call.status !== "ringing") {
      // Answered in another tab, cancelled by the caller, or timed out.
      setCall(null);
    }
  });

  // Stop ringing locally once the server-side ring timeout has passed.
  useEffect(() => {
    if (!call) return;
    const remaining = new Date(call.createdAt).getTime() + call.ringTimeoutSeconds * 1000 - Date.now();
    const t = setTimeout(() => setCall(null), Math.max(remaining, 0));
    return () => clearTimeout(t);
  }, [call]);

  if (!call || pathname === `/call/${call.id}`) return null;
  const caller = call.callerId === call.therapist.id ? call.therapist : call.patient;

  async function respond(action: "accept" | "reject") {
    if (!call) return;
    setBusy(true);
    try {
      await api(`/calls/${call.id}/${action}`, { body: {} });
      if (action === "accept") router.push(`/call/${call.id}`);
      setCall(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alertdialog" aria-live="assertive" aria-label={`Incoming call from ${caller.fullName}`} className="fixed inset-x-3 bottom-3 z-[1000] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[380px]">
      <div className="animate-[nd-fade-up_0.3s_ease] rounded-3xl bg-nd-surface-lowest p-5 shadow-[0_32px_64px_rgba(36,66,103,0.25)] ring-1 ring-nd-primary/10">
        <div className="flex items-center gap-4">
          <div className="relative">
            <span className="absolute inset-0 animate-ping rounded-full bg-nd-secondary" />
            <Avatar name={caller.fullName} size={56} className="relative" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-nd-muted">Incoming video call</p>
            <p className="truncate text-lg font-bold text-nd-primary">{caller.fullName}</p>
            <p className="text-sm capitalize text-nd-muted">{caller.role}</p>
          </div>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="danger" disabled={busy} onClick={() => respond("reject")}>Decline</Button>
          <Button disabled={busy} onClick={() => respond("accept")} className="!bg-emerald-600 hover:!bg-emerald-700">Accept</Button>
        </div>
      </div>
    </div>
  );
}
