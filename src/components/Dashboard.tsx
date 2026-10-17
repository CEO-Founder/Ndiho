"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LANGUAGES, SPECIALTIES } from "@/lib/schemas";
import { api, errorMessage } from "./api";
import { useRealtimeEvents } from "./RealtimeProvider";
import type { Account, CallParticipant, CallView, PublicTherapist } from "./types";
import { Avatar, Button, inputClass, LinkButton, Pill } from "./ui";

export function Dashboard({ account, welcome }: { account: Account; welcome: boolean }) {
  const router = useRouter();
  const [calls, setCalls] = useState<CallView[]>([]);
  const [callable, setCallable] = useState<CallParticipant[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(true);
  const [callError, setCallError] = useState<string | null>(null);
  const [calling, setCalling] = useState<string | null>(null);

  const loadCalls = useCallback(
    () =>
      api<{ calls: CallView[]; callablePatients?: CallParticipant[] }>("/calls")
        .then((data) => {
          setCalls(data.calls);
          setCallable(data.callablePatients ?? []);
        })
        // Keep what we have; the realtime stream will trigger another refresh.
        .catch(() => {})
        .finally(() => setLoadingCalls(false)),
    [],
  );

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  useRealtimeEvents((msg) => {
    if (msg.type === "call.incoming" || msg.type === "call.updated") loadCalls();
  });

  async function startCall(calleeId: string) {
    setCalling(calleeId);
    setCallError(null);
    try {
      const { call } = await api<{ call: CallView }>("/calls", { body: { calleeId } });
      router.push(`/call/${call.id}`);
    } catch (err) {
      setCallError(errorMessage(err));
      setCalling(null);
    }
  }

  const activeCall = calls.find((c) => c.status === "accepted" || (c.status === "ringing" && c.callerId === account.id));
  const firstName = account.fullName.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").split(" ")[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 flex flex-col gap-2">
        <Pill tone={account.role === "therapist" ? "tertiary" : "secondary"} className="w-fit capitalize">{account.role} account</Pill>
        <h1 className="font-nd-serif text-[clamp(30px,4vw,44px)] font-black tracking-tight text-nd-primary">
          {welcome ? "Welcome to Ndiho Space" : "Muraho"}, <span className="italic">{firstName}.</span>
        </h1>
        <p className="max-w-2xl text-nd-muted">
          {account.role === "therapist"
            ? "Keep this page open to receive video calls from your patients."
            : "Choose a verified therapist and start a confidential video consultation."}
        </p>
      </div>

      {activeCall && (
        <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200 sm:flex-row sm:items-center">
          <p className="text-sm font-semibold text-emerald-800">
            You have an active call with {activeCall.therapist.id === account.id ? activeCall.patient.fullName : activeCall.therapist.fullName}.
          </p>
          <LinkButton href={`/call/${activeCall.id}`} size="sm" className="!bg-emerald-600">Return to call</LinkButton>
        </div>
      )}
      {callError && <p role="alert" className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{callError}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {account.role === "therapist" ? (
            <TherapistPanel account={account} patients={callable} calling={calling} onCall={startCall} />
          ) : (
            <TherapistDirectory calling={calling} onCall={startCall} disabled={!!activeCall} />
          )}
        </div>
        <CallHistory calls={calls} loading={loadingCalls} me={account.id} />
      </div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-nd-surface-lowest p-5 shadow-[0_8px_32px_rgba(36,66,103,0.05)] sm:p-7 ${className}`}>{children}</section>;
}

function TherapistDirectory({ calling, onCall, disabled }: { calling: string | null; onCall: (id: string) => void; disabled: boolean }) {
  const [therapists, setTherapists] = useState<PublicTherapist[] | null>(null);
  const [specialty, setSpecialty] = useState("");
  const [language, setLanguage] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (specialty) params.set("specialty", specialty);
    if (language) params.set("language", language);
    let cancelled = false;
    api<{ therapists: PublicTherapist[] }>(`/therapists?${params}`)
      .then((d) => !cancelled && setTherapists(d.therapists))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [specialty, language]);

  return (
    <Card>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-nd-serif text-2xl font-bold text-nd-primary">Find your therapist</h2>
          <p className="text-sm text-nd-muted">Every therapist is license-verified by our team.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:w-[360px]">
          <select aria-label="Filter by specialty" className={`${inputClass} !py-2 text-sm`} value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
            <option value="">All specialties</option>
            {SPECIALTIES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select aria-label="Filter by language" className={`${inputClass} !py-2 text-sm`} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Any language</option>
            {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!therapists && !error && <p className="py-8 text-center text-sm text-nd-muted">Loading therapists…</p>}
      {therapists?.length === 0 && (
        <p className="rounded-2xl bg-nd-surface-low px-4 py-8 text-center text-sm text-nd-muted">
          No verified therapists match these filters yet. Try another specialty or language.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {therapists?.map((t) => (
          <li key={t.id} className="flex flex-col gap-4 rounded-2xl bg-nd-surface-low/60 p-4 sm:flex-row sm:items-start">
            <Avatar name={t.fullName} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-[17px] font-bold text-nd-primary">{t.fullName}</p>
                <span className="text-xs font-semibold text-emerald-700">✓ Verified</span>
              </div>
              <p className="text-sm text-nd-muted">
                {t.professionalTitle} · {t.yearsExperience} yrs experience
                {t.sessionFeeRwf != null && ` · RWF ${t.sessionFeeRwf.toLocaleString()}`}
              </p>
              {t.bio && <p className="mt-2 line-clamp-2 text-sm text-nd-on-background/80">{t.bio}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.specialties.map((s) => <Pill key={s} tone="fixed">{s}</Pill>)}
                {t.languages.map((l) => <Pill key={l} tone="muted">{l}</Pill>)}
              </div>
            </div>
            <Button size="sm" onClick={() => onCall(t.id)} disabled={disabled || calling !== null} className="w-full sm:w-auto">
              {calling === t.id ? "Calling…" : "📹 Video call"}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TherapistPanel({ account, patients, calling, onCall }: {
  account: Account;
  patients: CallParticipant[];
  calling: string | null;
  onCall: (id: string) => void;
}) {
  const t = account.therapist!;
  const status = {
    pending: { tone: "bg-amber-50 ring-amber-200 text-amber-900", title: "Verification in progress", body: "We're reviewing your license. Once verified, your profile appears in the therapist directory and patients can call you." },
    verified: { tone: "bg-emerald-50 ring-emerald-200 text-emerald-900", title: "Your profile is verified", body: "Patients can find you in the directory and start video consultations." },
    rejected: { tone: "bg-red-50 ring-red-200 text-red-900", title: "Verification unsuccessful", body: "We couldn't verify your license details. Please check them on your profile or contact support." },
  }[t.verificationStatus];

  return (
    <>
      <div className={`rounded-2xl p-5 ring-1 ${status.tone}`}>
        <p className="font-bold">{status.title}</p>
        <p className="mt-1 text-sm opacity-90">{status.body}</p>
      </div>
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar name={account.fullName} size={72} />
          <div className="min-w-0 flex-1">
            <p className="text-xl font-bold text-nd-primary">{account.fullName}</p>
            <p className="text-sm text-nd-muted">{t.professionalTitle} · {t.licensingBody} ({t.licenseCountry})</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {t.specialties.map((s) => <Pill key={s} tone="fixed">{s}</Pill>)}
              {t.languages.map((l) => <Pill key={l} tone="muted">{l}</Pill>)}
            </div>
          </div>
          <LinkButton href="/profile" variant="outline" size="sm">Edit profile</LinkButton>
        </div>
      </Card>
      <Card>
        <h2 className="font-nd-serif text-2xl font-bold text-nd-primary">Your patients</h2>
        <p className="mb-4 text-sm text-nd-muted">Patients who have contacted you. You can call them back at any time.</p>
        {patients.length === 0 ? (
          <p className="rounded-2xl bg-nd-surface-low px-4 py-8 text-center text-sm text-nd-muted">
            No patients yet. When a patient calls you, they&apos;ll appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {patients.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-nd-surface-low/60 p-3">
                <Avatar name={p.fullName} size={40} />
                <span className="min-w-0 flex-1 truncate font-semibold text-nd-primary">{p.fullName}</span>
                <Button size="sm" variant="secondary" disabled={calling !== null || t.verificationStatus !== "verified"} onClick={() => onCall(p.id)}>
                  {calling === p.id ? "Calling…" : "Call back"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ringing: { label: "Ringing", className: "bg-nd-secondary text-nd-primary" },
  accepted: { label: "In progress", className: "bg-emerald-100 text-emerald-800" },
  ended: { label: "Completed", className: "bg-nd-primary-fixed text-nd-primary" },
  missed: { label: "Missed", className: "bg-amber-100 text-amber-800" },
  rejected: { label: "Declined", className: "bg-red-50 text-red-700" },
  cancelled: { label: "Cancelled", className: "bg-nd-surface-low text-nd-muted" },
};

function CallHistory({ calls, loading, me }: { calls: CallView[]; loading: boolean; me: string }) {
  const fmt = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }), []);
  return (
    <Card className="h-fit">
      <h2 className="mb-4 font-nd-serif text-xl font-bold text-nd-primary">Recent calls</h2>
      {loading ? (
        <p className="text-sm text-nd-muted">Loading…</p>
      ) : calls.length === 0 ? (
        <p className="text-sm text-nd-muted">No calls yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-nd-surface-highest/60">
          {calls.map((c) => {
            const other = c.therapist.id === me ? c.patient : c.therapist;
            const s = STATUS_LABEL[c.status];
            const duration = c.answeredAt && c.endedAt ? Math.round((+new Date(c.endedAt) - +new Date(c.answeredAt)) / 60000) : null;
            return (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <Avatar name={other.fullName} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-nd-primary">
                    {c.callerId === me ? "↗ " : "↙ "}
                    {other.fullName}
                  </p>
                  <p className="text-xs text-nd-muted">
                    {fmt.format(new Date(c.createdAt))}
                    {duration !== null && ` · ${duration < 1 ? "<1" : duration} min`}
                  </p>
                </div>
                {c.status === "accepted" ? (
                  <Link href={`/call/${c.id}`} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.className}`}>Join</Link>
                ) : (
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.className}`}>{s.label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
