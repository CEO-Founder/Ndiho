"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LANGUAGES, SPECIALTIES } from "@/lib/schemas";
import { api, errorMessage } from "./api";
import { useRealtimeEvents } from "./RealtimeProvider";
import { AppointmentList, Card, PLATFORM_TIMEZONE_LABEL, StatTiles } from "./sessions";
import type { Account, AppointmentView, CallParticipant, CallView, DashboardStats, PublicTherapist } from "./types";
import { Avatar, Button, inputClass, LinkButton, Pill } from "./ui";

interface PatientSummary {
  id: string;
  fullName: string;
  sessionsHeld: number;
  lastSessionAt: string | null;
  nextAppointmentAt: string | null;
}

export function Dashboard({ account, welcome }: { account: Account; welcome: boolean }) {
  const router = useRouter();
  const [calls, setCalls] = useState<CallView[]>([]);
  const [callable, setCallable] = useState<CallParticipant[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(true);
  const [callError, setCallError] = useState<string | null>(null);
  const [calling, setCalling] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<AppointmentView[] | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);

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

  const loadSessions = useCallback(
    () =>
      Promise.all([
        api<{ appointments: AppointmentView[] }>("/appointments").then((d) => setAppointments(d.appointments)),
        api<{ stats: DashboardStats }>("/dashboard").then((d) => setStats(d.stats)),
      ]).catch(() => {}),
    [],
  );

  useEffect(() => {
    void loadCalls();
    void loadSessions();
  }, [loadCalls, loadSessions]);

  useRealtimeEvents((msg) => {
    if (msg.type === "call.incoming" || msg.type === "call.updated") {
      loadCalls();
      if (msg.type === "call.updated" && msg.call.status === "ended") loadSessions();
    }
    if (msg.type === "appointment.updated") loadSessions();
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
            : "Book a session with a verified therapist, or call one who is available now."}
        </p>
      </div>

      {stats && (
        <div className="mb-6">
          <StatTiles
            items={[
              { label: "Upcoming sessions", value: stats.upcomingSessions },
              { label: "Sessions this week", value: stats.sessionsThisWeek },
              { label: "Minutes this month", value: stats.minutesThisMonth },
              ...(stats.patients !== undefined ? [{ label: "Patients", value: stats.patients }] : []),
            ]}
          />
        </div>
      )}

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
          <Card>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-nd-serif text-2xl font-bold text-nd-primary">Upcoming sessions</h2>
                <p className="text-sm text-nd-muted">Times in {PLATFORM_TIMEZONE_LABEL}. Join opens 10 minutes before the start.</p>
              </div>
              {account.role === "patient" ? (
                <LinkButton href="/book" size="sm">+ Book a session</LinkButton>
              ) : (
                <LinkButton href="/availability" size="sm" variant="outline">Set availability</LinkButton>
              )}
            </div>
            {appointments === null ? (
              <p className="py-6 text-center text-sm text-nd-muted">Loading…</p>
            ) : (
              <AppointmentList
                appointments={appointments}
                me={account.id}
                onChanged={loadSessions}
                empty={
                  <p className="rounded-2xl bg-nd-surface-low px-4 py-8 text-center text-sm text-nd-muted">
                    {account.role === "patient"
                      ? "No sessions booked yet. Choose a therapist below and pick a time that suits you."
                      : "No sessions booked yet. Make sure your weekly availability is set so patients can book you."}
                  </p>
                }
              />
            )}
          </Card>
          {account.role === "therapist" ? (
            <TherapistPanel
              account={account}
              patients={callable}
              calling={calling}
              onCall={startCall}
              refreshKey={appointments?.map((a) => `${a.id}:${a.status}`).join() ?? ""}
            />
          ) : (
            <TherapistDirectory calling={calling} onCall={startCall} disabled={!!activeCall} />
          )}
        </div>
        <CallHistory calls={calls} loading={loadingCalls} me={account.id} />
      </div>
    </div>
  );
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
            <div className="flex w-full gap-2 sm:w-auto sm:flex-col">
              <LinkButton href={`/book?therapist=${t.id}`} size="sm" className="flex-1">Book a session</LinkButton>
              <Button size="sm" variant="outline" onClick={() => onCall(t.id)} disabled={disabled || calling !== null} className="flex-1">
                {calling === t.id ? "Calling…" : "📹 Call now"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TherapistPanel({ account, patients, calling, onCall, refreshKey }: {
  account: Account;
  patients: CallParticipant[];
  calling: string | null;
  onCall: (id: string) => void;
  /** Changes when bookings change, so the patient list reloads live. */
  refreshKey: string;
}) {
  const t = account.therapist!;
  const status = {
    pending: { tone: "bg-amber-50 ring-amber-200 text-amber-900", title: "Verification in progress", body: "We're reviewing your license. Once verified, your profile appears in the therapist directory and patients can call you." },
    verified: { tone: "bg-emerald-50 ring-emerald-200 text-emerald-900", title: "Your profile is verified", body: "Patients can find you in the directory and start video consultations." },
    rejected: { tone: "bg-red-50 ring-red-200 text-red-900", title: "Verification unsuccessful", body: "We couldn't verify your license details. Please correct them on your profile — that sends them for review again." },
  }[t.verificationStatus];
  const [list, setList] = useState<PatientSummary[] | null>(null);
  const callableIds = new Set(patients.map((p) => p.id));
  useEffect(() => {
    let cancelled = false;
    api<{ patients: PatientSummary[] }>("/patients")
      .then((d) => !cancelled && setList(d.patients))
      .catch(() => !cancelled && setList([]));
    return () => {
      cancelled = true;
    };
  }, [patients, refreshKey]);

  return (
    <>
      <div className={`rounded-2xl p-5 ring-1 ${status.tone}`}>
        <p className="font-bold">{status.title}</p>
        <p className="mt-1 text-sm opacity-90">{status.body}</p>
        {t.verificationStatus === "rejected" && t.verificationNotes && (
          <p className="mt-2 rounded-lg bg-white/60 px-3 py-2 text-sm"><strong>Reviewer&apos;s note:</strong> {t.verificationNotes}</p>
        )}
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
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-nd-serif text-2xl font-bold text-nd-primary">Your patients</h2>
            <p className="text-sm text-nd-muted">Patients who booked or called you.</p>
          </div>
          {list && list.length > 0 && <Link href="/patients" className="text-sm font-semibold text-nd-primary-light hover:underline">View all →</Link>}
        </div>
        {list === null ? (
          <p className="py-6 text-center text-sm text-nd-muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="rounded-2xl bg-nd-surface-low px-4 py-8 text-center text-sm text-nd-muted">
            No patients yet. When a patient books or calls you, they&apos;ll appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-nd-surface-low/60 p-3">
                <Avatar name={p.fullName} size={40} />
                <Link href={`/patients/${p.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-nd-primary hover:underline">{p.fullName}</span>
                  <span className="block text-xs text-nd-muted">
                    {p.sessionsHeld} session{p.sessionsHeld === 1 ? "" : "s"}
                    {p.nextAppointmentAt && ` · next ${new Date(p.nextAppointmentAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}
                  </span>
                </Link>
                {callableIds.has(p.id) && (
                  <Button size="sm" variant="secondary" disabled={calling !== null || t.verificationStatus !== "verified"} onClick={() => onCall(p.id)}>
                    {calling === p.id ? "Calling…" : "Call back"}
                  </Button>
                )}
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
