"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api";
import { Card, formatWhen, StatTiles } from "./sessions";
import { Avatar, Button, inputClass, Pill } from "./ui";

interface Overview {
  patients: number;
  therapists: { pending: number; verified: number; rejected: number };
  sessionsToday: number;
  sessionsLast7Days: number;
  minutesLast30Days: number;
  upcomingAppointments: number;
  activeCalls: number;
}

interface AdminTherapist {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  accountStatus: string;
  professionalTitle: string;
  licenseNumber: string;
  licensingBody: string;
  licenseCountry: string;
  yearsExperience: number;
  specialties: string[];
  languages: string[];
  bio: string;
  verificationStatus: "pending" | "verified" | "rejected";
  verificationNotes: string | null;
  createdAt: string;
}

interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  accountStatus: string;
  createdAt: string;
  lastLoginAt: string | null;
}

const STATUS_TONE = { pending: "tertiary", verified: "secondary", rejected: "muted" } as const;

export function AdminDashboard({ me }: { me: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<"review" | "users">("review");
  const loadOverview = useCallback(() => api<{ overview: Overview }>("/admin/overview").then((d) => setOverview(d.overview)).catch(() => {}), []);
  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <Pill tone="tertiary" className="mb-2">Administrator</Pill>
      <h1 className="font-nd-serif text-[clamp(30px,4vw,44px)] font-black tracking-tight text-nd-primary">Platform overview</h1>
      <p className="mb-6 text-nd-muted">Review therapists, manage accounts and keep an eye on activity.</p>

      {overview && (
        <div className="flex flex-col gap-3">
          <StatTiles
            items={[
              { label: "Pending review", value: overview.therapists.pending, hint: "therapists waiting" },
              { label: "Verified therapists", value: overview.therapists.verified },
              { label: "Patients", value: overview.patients },
              { label: "Upcoming bookings", value: overview.upcomingAppointments },
            ]}
          />
          <StatTiles
            items={[
              { label: "Sessions today", value: overview.sessionsToday },
              { label: "Sessions (7 days)", value: overview.sessionsLast7Days },
              { label: "Minutes (30 days)", value: overview.minutesLast30Days },
              { label: "Live calls now", value: overview.activeCalls },
            ]}
          />
        </div>
      )}

      <div role="tablist" className="mb-6 mt-8 flex w-fit rounded-full bg-nd-surface-low p-1">
        {(
          [
            ["review", `Therapist review${overview?.therapists.pending ? ` (${overview.therapists.pending})` : ""}`],
            ["users", "Users"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${tab === key ? "bg-nd-primary text-white" : "text-nd-muted hover:text-nd-primary"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "review" ? <TherapistReview onChanged={loadOverview} /> : <Users me={me} />}
    </div>
  );
}

function TherapistReview({ onChanged }: { onChanged: () => void }) {
  const [filter, setFilter] = useState<"pending" | "verified" | "rejected" | "">("pending");
  const [list, setList] = useState<AdminTherapist[] | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ therapists: AdminTherapist[] }>(`/admin/therapists${filter ? `?status=${filter}` : ""}`)
        .then((d) => setList(d.therapists))
        .catch((e) => setError(errorMessage(e))),
    [filter],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: "verify" | "reject", reason?: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/admin/therapists/${id}/${decision}`, { body: decision === "reject" ? { reason } : {} });
      setRejecting(null);
      await load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(["pending", "verified", "rejected", ""] as const).map((f) => (
          <button key={f || "all"} onClick={() => setFilter(f)} className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${filter === f ? "bg-nd-primary-fixed text-nd-primary" : "text-nd-muted hover:text-nd-primary"}`}>
            {f || "all"}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {list === null ? (
        <p className="text-sm text-nd-muted">Loading…</p>
      ) : list.length === 0 ? (
        <Card className="text-center text-sm text-nd-muted">{filter === "pending" ? "No therapists waiting for review. 🎉" : "Nothing here."}</Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((t) => (
            <li key={t.id} data-testid="review-card">
              <Card>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <Avatar name={t.fullName} size={56} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-bold text-nd-primary">{t.fullName}</p>
                      <Pill tone={STATUS_TONE[t.verificationStatus]} className="capitalize">{t.verificationStatus}</Pill>
                      {t.accountStatus !== "active" && <Pill tone="muted">Suspended</Pill>}
                    </div>
                    <p className="text-sm text-nd-muted">{t.professionalTitle} · {t.yearsExperience} yrs · registered {formatWhen(t.createdAt)}</p>
                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      {[
                        ["Licensing body", t.licensingBody],
                        ["License number", t.licenseNumber],
                        ["Country", t.licenseCountry],
                        ["Email", t.email],
                        ["Phone", t.phone ?? "—"],
                      ].map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <dt className="shrink-0 text-nd-muted">{k}:</dt>
                          <dd className="min-w-0 truncate font-medium text-nd-on-background">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {t.specialties.map((s) => <Pill key={s} tone="fixed">{s}</Pill>)}
                      {t.languages.map((l) => <Pill key={l} tone="muted">{l}</Pill>)}
                    </div>
                    {t.bio && <p className="mt-3 text-sm text-nd-on-background/80">{t.bio}</p>}
                    {t.verificationNotes && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Rejection note: {t.verificationNotes}</p>}
                  </div>
                </div>
                {rejecting?.id === t.id ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      autoFocus
                      className={inputClass}
                      placeholder="Reason the therapist will see, e.g. license number not found in the register"
                      value={rejecting.reason}
                      onChange={(e) => setRejecting({ id: t.id, reason: e.target.value })}
                    />
                    <Button variant="danger" size="sm" disabled={busy === t.id || rejecting.reason.trim().length < 3} onClick={() => decide(t.id, "reject", rejecting.reason)}>
                      Confirm rejection
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {t.verificationStatus !== "verified" && (
                      <Button size="sm" disabled={busy === t.id} onClick={() => decide(t.id, "verify")} className="!bg-emerald-600 hover:!bg-emerald-700">
                        ✓ Approve
                      </Button>
                    )}
                    {t.verificationStatus !== "rejected" && (
                      <Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => setRejecting({ id: t.id, reason: "" })}>
                        {t.verificationStatus === "verified" ? "Revoke verification" : "Reject"}
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Users({ me }: { me: string }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    (term: string) =>
      api<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(term)}`)
        .then((d) => setUsers(d.users))
        .catch((e) => setError(errorMessage(e))),
    [],
  );
  useEffect(() => {
    const t = setTimeout(() => void search(q), 250);
    return () => clearTimeout(t);
  }, [q, search]);

  async function setStatus(u: AdminUser, action: "suspend" | "activate") {
    if (action === "suspend" && !window.confirm(`Suspend ${u.fullName}? They will be signed out immediately and can't sign in until reactivated.`)) return;
    setBusy(u.id);
    setError(null);
    try {
      await api(`/admin/users/${u.id}/${action}`, { body: {} });
      await search(q);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <input type="search" className={`${inputClass} mb-4 max-w-md`} placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <Card className="!p-0 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase text-nd-muted">
            <tr>
              <th className="px-5 py-3 font-semibold">Name</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 font-semibold">Joined</th>
              <th className="px-5 py-3 font-semibold">Last sign-in</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-nd-surface-highest/70">
            {users?.map((u) => (
              <tr key={u.id} data-testid="user-row">
                <td className="px-5 py-3">
                  <p className="font-semibold text-nd-primary">{u.fullName}</p>
                  <p className="text-xs text-nd-muted">{u.email}</p>
                </td>
                <td className="px-5 py-3 capitalize">{u.role}</td>
                <td className="px-5 py-3 text-nd-muted">{formatWhen(u.createdAt)}</td>
                <td className="px-5 py-3 text-nd-muted">{u.lastLoginAt ? formatWhen(u.lastLoginAt) : "—"}</td>
                <td className="px-5 py-3">
                  <Pill tone={u.accountStatus === "active" ? "secondary" : "muted"} className="capitalize">{u.accountStatus}</Pill>
                </td>
                <td className="px-5 py-3 text-right">
                  {u.id !== me &&
                    (u.accountStatus === "active" ? (
                      <Button size="sm" variant="ghost" disabled={busy === u.id} onClick={() => setStatus(u, "suspend")} className="!text-red-600">Suspend</Button>
                    ) : (
                      <Button size="sm" variant="secondary" disabled={busy === u.id} onClick={() => setStatus(u, "activate")}>Reactivate</Button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users?.length === 0 && <p className="p-8 text-center text-sm text-nd-muted">No users match.</p>}
      </Card>
    </div>
  );
}
