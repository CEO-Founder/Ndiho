"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDate, formatTime, formatWhen, serviceLabel } from "@/lib/format";
import { PLATFORM_TIMEZONE_LABEL } from "@/lib/time";
import { api, ApiClientError, errorMessage } from "./api";
import type { AppointmentView, CallView } from "./types";
import { Avatar, Button, Pill } from "./ui";

export { formatDate, formatTime, formatWhen, PLATFORM_TIMEZONE_LABEL, serviceLabel };

/** Current time, re-rendering every `ms` so time-based buttons open on schedule. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-nd-surface-lowest p-5 shadow-[0_8px_32px_rgba(36,66,103,0.05)] sm:p-7 ${className}`}>{children}</section>;
}

export function StatTiles({ items }: { items: { label: string; value: number | string; hint?: string }[] }) {
  const colors = ["bg-nd-primary-fixed", "bg-nd-tertiary", "bg-nd-secondary", "bg-nd-lavender"];
  return (
    <div className={`grid grid-cols-2 gap-3 ${items.length > 3 ? "lg:grid-cols-4" : "sm:grid-cols-3"}`}>
      {items.map((it, i) => (
        <div key={it.label} className={`rounded-2xl p-4 sm:p-5 ${colors[i % colors.length]}`}>
          <p className="font-nd-serif text-3xl font-black text-nd-primary" data-testid={`stat-${it.label}`}>{it.value}</p>
          <p className="mt-1 text-xs font-semibold text-nd-primary/70">{it.label}</p>
          {it.hint && <p className="text-[11px] text-nd-primary/50">{it.hint}</p>}
        </div>
      ))}
    </div>
  );
}

/** Starts the video call for a booked session and opens the call room. */
export async function joinSession(router: ReturnType<typeof useRouter>, a: AppointmentView, me: string) {
  const calleeId = a.therapist.id === me ? a.patient.id : a.therapist.id;
  try {
    const { call } = await api<{ call: CallView }>("/calls", { body: { calleeId, appointmentId: a.id } });
    router.push(`/call/${call.id}`);
    return null;
  } catch (err) {
    if (err instanceof ApiClientError && err.code === "CALLEE_BUSY") {
      return "They're calling you right now — answer the incoming call.";
    }
    return errorMessage(err);
  }
}

export function AppointmentList({
  appointments,
  me,
  empty,
  onChanged,
}: {
  appointments: AppointmentView[];
  me: string;
  empty: React.ReactNode;
  onChanged: () => void;
}) {
  const router = useRouter();
  const now = useNow(15_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);

  if (appointments.length === 0) return <>{empty}</>;

  async function join(a: AppointmentView) {
    setBusy(a.id);
    setError(null);
    const problem = await joinSession(router, a, me);
    if (problem) {
      setError({ id: a.id, text: problem });
      setBusy(null);
    }
  }

  async function cancel(a: AppointmentView) {
    const other = a.therapist.id === me ? a.patient.fullName : a.therapist.fullName;
    const reason = window.prompt(`Cancel your session with ${other} on ${formatWhen(a.startsAt)}?\n\nOptional: tell them why.`);
    if (reason === null) return;
    setBusy(a.id);
    setError(null);
    try {
      await api(`/appointments/${a.id}/cancel`, { body: { reason: reason || undefined } });
      onChanged();
    } catch (err) {
      setError({ id: a.id, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="flex flex-col gap-3">
      {appointments.map((a) => {
        const other = a.therapist.id === me ? a.patient : a.therapist;
        const joinable = a.status !== "cancelled" && now >= Date.parse(a.joinOpensAt) && now <= Date.parse(a.joinClosesAt);
        const started = now >= Date.parse(a.startsAt);
        const minutesToStart = Math.round((Date.parse(a.startsAt) - now) / 60000);
        return (
          <li key={a.id} data-testid="appointment" className={`rounded-2xl p-4 ${joinable ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-nd-surface-low/60"}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="w-16 shrink-0 rounded-xl bg-nd-surface-lowest py-2 text-center">
                  <p className="text-[11px] font-semibold uppercase text-nd-muted">{formatDate(a.startsAt).split(" ")[0]}</p>
                  <p className="text-lg font-black leading-tight text-nd-primary">{formatTime(a.startsAt)}</p>
                </div>
                <Avatar name={other.fullName} size={40} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-nd-primary">{other.fullName}</p>
                  <p className="truncate text-xs text-nd-muted">
                    {serviceLabel(a.service)} · {formatDate(a.startsAt)} · {a.durationMinutes} min
                  </p>
                  {a.patientNote && a.therapist.id === me && <p className="mt-1 line-clamp-2 text-xs italic text-nd-on-background/70">“{a.patientNote}”</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {a.status === "cancelled" ? (
                  <Pill tone="muted">Cancelled{a.cancelledBy === me ? " by you" : ""}</Pill>
                ) : a.status === "completed" && !joinable ? (
                  <Pill tone="fixed">Session held</Pill>
                ) : joinable ? (
                  <Button size="sm" disabled={busy === a.id} onClick={() => join(a)} className="!bg-emerald-600 hover:!bg-emerald-700">
                    {busy === a.id ? "Connecting…" : "📹 Join session"}
                  </Button>
                ) : (
                  <span className="text-xs font-medium text-nd-muted">
                    {minutesToStart > 60 * 24 ? `in ${Math.round(minutesToStart / 1440)} days` : minutesToStart > 60 ? `in ${Math.round(minutesToStart / 60)} h` : `in ${minutesToStart} min`}
                  </span>
                )}
                {a.status === "booked" && !started && (
                  <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => cancel(a)}>Cancel</Button>
                )}
              </div>
            </div>
            {a.status === "cancelled" && a.cancelReason && <p className="mt-2 text-xs text-nd-muted">Reason: {a.cancelReason}</p>}
            {error?.id === a.id && <p role="alert" className="mt-2 text-sm text-red-600">{error.text}</p>}
          </li>
        );
      })}
    </ul>
  );
}
